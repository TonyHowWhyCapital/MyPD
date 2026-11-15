package mypd;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Database side of test data: counts rows, reads existing keys, runs a read-only query and
 * writes a bundle of generated rows.
 *
 * The only argument is params=<file>: a JSON file (owner-only, deleted here once read unless
 * "keepParams" is true) so that neither the password nor the url shows in the process list:
 *   {"mode":"count|keys|query|write", "driver_class_name":..., "url":..., "username":...,
 *    "password":..., "out":<result file>, "dialect":<optional override>,
 *    count: "tables":[names]
 *    keys:  "table":..., "column":..., "limit":n
 *    query: "sql":..., "limit":n, "timeout":seconds
 *    write: "dir":<bundle>, "existing":"append|clear", "onError":"rollback|skip",
 *           "progress":<file>, "batchSize":n}
 * The result file holds {"status":"SUCCESS","body":...} or {"status":"FAILED","body":{code,message,...}}.
 */
public class TestData {
  private static final int MAX_LIMIT = 1000000;

  public static void main(String[] args) throws Exception {
    Map<String, Object> p;
    try {
      Path file = Paths.get(Tool.params(args).get("params"));
      String text = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
      p = TestDataJson.object(TestDataJson.parse(text), "The parameter file");
      if (!Boolean.TRUE.equals(p.get("keepParams"))) {
        Files.deleteIfExists(file);
      }
    } catch (Throwable e) {
      System.err.println("TestData: cannot read the parameter file (params=<file>)");
      System.exit(2);
      return;
    }
    String out = TestDataJson.str(p, "out");
    int exit = 0;
    try {
      Tool.write(out, "SUCCESS", run(p));
    } catch (Throwable e) {
      TestDataFailure f = e instanceof TestDataSqlCheck.Rejected
          ? new TestDataFailure(((TestDataSqlCheck.Rejected) e).code, e.getMessage())
          : TestDataDb.failure(e);
      Tool.write(out, "FAILED", f.toJson());
      exit = 1;
    }
    System.exit(exit);
  }

  private static String run(Map<String, Object> p) throws Exception {
    String mode = TestDataJson.str(p, "mode");
    if ("query".equals(mode)) {
      // refused before any connection is made
      String sql = TestDataSqlCheck.check(TestDataJson.str(p, "sql"));
      try (TestDataDb db = TestDataDb.open(p)) {
        return query(db, sql, limit(p), (int) TestDataJson.num(p, "timeout", 30));
      }
    }
    try (TestDataDb db = TestDataDb.open(p)) {
      if ("count".equals(mode)) {
        return count(db, TestDataJson.list(p.get("tables"), "tables"));
      }
      if ("keys".equals(mode)) {
        return keys(db, TestDataJson.str(p, "table"), TestDataJson.str(p, "column"), limit(p));
      }
      if ("write".equals(mode)) {
        return new TestDataWrite(db, p).run();
      }
      throw new TestDataFailure("BAD_PARAMS", "Unknown mode: " + mode);
    }
  }

  private static int limit(Map<String, Object> p) {
    long n = TestDataJson.num(p, "limit", 10000);
    return (int) Math.max(1, Math.min(MAX_LIMIT, n <= 0 ? 10000 : n));
  }

  /** {"counts":{table: n|null}, "errors":{table: message}} — null for a table that is not there. */
  private static String count(TestDataDb db, List<Object> tables) throws Exception {
    StringBuilder counts = new StringBuilder("{");
    StringBuilder errors = new StringBuilder("{");
    for (Object o : tables) {
      String name = String.valueOf(o);
      String value = "null";
      try {
        TestDataDb.Table t = db.table(name);
        if (t != null) {
          try (Statement st = db.conn.createStatement();
               ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM " + t.sql)) {
            rs.next();
            value = String.valueOf(rs.getLong(1));
          }
        }
      } catch (SQLException e) {
        // one unreadable table must not hide the others
        errors.append(errors.length() > 1 ? "," : "").append(Tool.json(name)).append(':')
            .append(Tool.json(TestDataDb.clean(String.valueOf(e.getMessage()))));
      }
      counts.append(counts.length() > 1 ? "," : "").append(Tool.json(name)).append(':').append(value);
    }
    return "{\"counts\":" + counts + "},\"errors\":" + errors + "}}";
  }

  private static String keys(TestDataDb db, String table, String column, int limit) throws Exception {
    TestDataDb.Table t = db.table(table);
    if (t == null) {
      throw new TestDataFailure("TABLE_MISSING", "The table " + table + " does not exist").at(table, -1);
    }
    TestDataDb.Column c = t.columns.get(column.toLowerCase(Locale.ROOT));
    if (c == null && !t.columns.isEmpty()) {
      throw new TestDataFailure("COLUMN_MISSING",
          "The table " + table + " has no column " + column).at(table, -1);
    }
    String col = db.quote(c == null ? column : c.name);
    return select(db, "SELECT " + col + " FROM " + t.sql + " WHERE " + col + " IS NOT NULL", limit, 120);
  }

  private static String query(TestDataDb db, String sql, int limit, int timeout) throws Exception {
    return select(db, sql, limit, timeout <= 0 ? 30 : timeout);
  }

  /** First column of a query as a JSON array; read-only, limited, and always rolled back. */
  private static String select(TestDataDb db, String sql, int limit, int timeout) throws Exception {
    try {
      db.conn.setReadOnly(true);
    } catch (SQLException e) {
      // some drivers (SQLite) only take this when the connection is opened
    }
    db.conn.setAutoCommit(false);
    StringBuilder sb = new StringBuilder("[");
    try (Statement st = db.conn.createStatement()) {
      st.setMaxRows(limit);
      st.setFetchSize(Math.min(limit, 1000));
      try {
        st.setQueryTimeout(timeout);
      } catch (SQLException e) {
        // not every driver has a timeout
      }
      try (ResultSet rs = st.executeQuery(sql)) {
        int type = rs.getMetaData().getColumnType(1);
        int n = 0;
        while (n < limit && rs.next()) {
          sb.append(n++ > 0 ? "," : "").append(db.jsonValue(rs, 1, type));
        }
      }
    } finally {
      try {
        db.conn.rollback();
      } catch (SQLException e) {
        // nothing was changed anyway
      }
    }
    return sb.append(']').toString();
  }
}
