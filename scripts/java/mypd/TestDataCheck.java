package mypd;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;

/**
 * Lets the database judge the query of a "query" rule: whether it is correct, whether the
 * tables and columns it reads exist and what its first column holds. Read-only, limited to a
 * few rows, with a time limit, and always rolled back.
 *
 * Two steps, because databases differ in when they look at a statement: it is prepared and
 * described first (PostgreSQL, Oracle and SQL Server answer here without running anything),
 * then run for a handful of rows (MySQL only looks at a statement when it runs it).
 *
 * Result: {"columns":[{"name","typeName","jdbcType","nullable":true|false|null}],
 *          "sample":[values of the first column], "rowsSeen":n, "truncated":bool,
 *          "dialect":...}; `truncated` says that the query has more rows than were read.
 */
final class TestDataCheck {
  private static final int MAX_SAMPLE = 100;

  private TestDataCheck() {
  }

  static String run(TestDataDb db, TestDataSqlCheck.Checked q, int wanted, int timeout)
      throws Exception {
    int sample = Math.max(1, Math.min(MAX_SAMPLE, wanted <= 0 ? 5 : wanted));
    try {
      db.conn.setReadOnly(true);
    } catch (SQLException e) {
      // some drivers (SQLite) only take this when the connection is opened
    }
    db.conn.setAutoCommit(false);
    String phase = "prepare";
    Thread stop = null;
    try (PreparedStatement st = db.conn.prepareStatement(q.sql)) {
      // a cancelled check ends this process: the server is told to stop the query too
      stop = new Thread(() -> {
        try {
          st.cancel();
        } catch (Throwable e) {
          // the connection goes away with the process anyway
        }
      });
      Runtime.getRuntime().addShutdownHook(stop);
      // one row more than shown tells whether there are more
      st.setMaxRows(sample + 1);
      st.setFetchSize(sample + 1);
      try {
        st.setQueryTimeout(timeout);
      } catch (SQLException e) {
        // not every driver has a timeout
      }
      if (!"mysql".equals(db.dialect)) {
        // the MySQL driver would run the whole query here, outside the time limit
        try {
          st.getMetaData();
        } catch (SQLException e) {
          TestDataFailure f = TestDataDiagnose.failure(e, db.dialect, q, phase);
          if (f.position >= 0
              && f.code.matches("SQL_SYNTAX|TABLE_MISSING|COLUMN_MISSING|PERMISSION_DENIED")) {
            throw f;
          }
          // anything else may be the driver not being able to describe, and Oracle only says
          // where a statement is wrong when it is run: running decides
          rollback(db);
        }
      }
      phase = "execute";
      try (ResultSet rs = st.executeQuery()) {
        ResultSetMetaData md = rs.getMetaData();
        int width = md.getColumnCount();
        StringBuilder columns = new StringBuilder("[");
        for (int i = 1; i <= width; i++) {
          int nullable = md.isNullable(i);
          String isNull = "null";
          if (nullable != ResultSetMetaData.columnNullableUnknown) {
            isNull = String.valueOf(nullable == ResultSetMetaData.columnNullable);
          }
          String type = md.getColumnTypeName(i);
          columns.append(i > 1 ? "," : "").append("{\"name\":")
              .append(Tool.json(String.valueOf(md.getColumnLabel(i))))
              .append(",\"typeName\":").append(Tool.json(type == null ? "" : type))
              .append(",\"jdbcType\":").append(md.getColumnType(i))
              .append(",\"nullable\":").append(isNull).append('}');
        }
        int type = md.getColumnType(1);
        StringBuilder values = new StringBuilder("[");
        int seen = 0;
        boolean more = false;
        while (rs.next()) {
          if (seen >= sample) {
            more = true;
            break;
          }
          values.append(seen++ > 0 ? "," : "").append(db.jsonValue(rs, 1, type));
        }
        return "{\"columns\":" + columns + "],\"sample\":" + values + "],\"rowsSeen\":" + seen
            + ",\"truncated\":" + more + ",\"dialect\":" + Tool.json(db.dialect) + "}";
      }
    } catch (SQLException e) {
      throw TestDataDiagnose.failure(e, db.dialect, q, phase);
    } finally {
      if (stop != null) {
        try {
          Runtime.getRuntime().removeShutdownHook(stop);
        } catch (IllegalStateException e) {
          // already shutting down
        }
      }
      rollback(db);
    }
  }

  private static void rollback(TestDataDb db) {
    try {
      db.conn.rollback();
    } catch (SQLException e) {
      // nothing was changed anyway
    }
  }
}
