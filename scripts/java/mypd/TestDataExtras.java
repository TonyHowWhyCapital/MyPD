package mypd;

import java.sql.BatchUpdateException;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/** What single databases need around a write: clearing, auto increment values, identities. */
final class TestDataExtras {
  private TestDataExtras() {
  }

  /**
   * MySQL replaces an explicit 0 in an AUTO_INCREMENT column with the next number, and the
   * children written for parent 0 would point at nothing.
   */
  static void keepZero(TestDataDb db) throws SQLException {
    if (!"mysql".equals(db.dialect)) {
      return;
    }
    try (Statement st = db.conn.createStatement()) {
      st.execute("SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''),"
          + " 'NO_AUTO_VALUE_ON_ZERO')");
    }
  }

  /**
   * PostgreSQL: a GENERATED ALWAYS AS IDENTITY column only takes an explicit value with
   * OVERRIDING SYSTEM VALUE. True when the table has such a column (PostgreSQL 10 or later).
   */
  static boolean pgAlwaysIdentity(TestDataDb db, TestDataDb.Table t) {
    if (!"postgresql".equals(db.dialect)) {
      return false;
    }
    String sql = "SELECT 1 FROM pg_attribute WHERE attrelid = CAST(? AS regclass)"
        + " AND attidentity = 'a' AND NOT attisdropped";
    java.sql.Savepoint sp = null;
    try {
      sp = db.conn.getAutoCommit() ? null : db.conn.setSavepoint();
      try (java.sql.PreparedStatement ps = db.conn.prepareStatement(sql)) {
        ps.setString(1, (t.schema == null ? "" : db.quote(t.schema) + ".") + db.quote(t.name));
        try (ResultSet rs = ps.executeQuery()) {
          return rs.next();
        }
      }
    } catch (Exception e) {
      try {
        if (sp != null) {
          db.conn.rollback(sp);
        }
      } catch (SQLException ignored) {
        // the insert will tell
      }
      return false;
    }
  }

  /**
   * Marks the columns the database computes itself. The drivers in the engine jar do not
   * report them (or, MySQL, report too many), so the catalog of each database is asked.
   */
  static void markGenerated(TestDataDb db, TestDataDb.Table t) {
    String sql;
    String first = t.schema;
    String name = t.name;
    try {
      if ("mysql".equals(db.dialect)) {
        sql = "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?"
            + " AND TABLE_NAME = ? AND GENERATION_EXPRESSION <> ''";
        first = t.catalog;
      } else if ("mssql".equals(db.dialect)) {
        sql = "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(?) AND ? IS NOT NULL"
            + " AND is_computed = 1";
        first = (t.catalog == null ? "" : db.quote(t.catalog) + ".")
            + (t.schema == null ? "" : db.quote(t.schema)) + "." + db.quote(t.name);
      } else if ("postgresql".equals(db.dialect)) {
        sql = "SELECT attname FROM pg_attribute WHERE attrelid = CAST(? AS regclass)"
            + " AND ? IS NOT NULL AND attgenerated <> '' AND NOT attisdropped";
        first = (t.schema == null ? "" : db.quote(t.schema) + ".") + db.quote(t.name);
      } else if ("oracle".equals(db.dialect)) {
        sql = "SELECT column_name FROM all_tab_cols WHERE owner = ? AND table_name = ?"
            + " AND virtual_column = 'YES' AND hidden_column = 'NO'";
      } else {
        return;
      }
      try (java.sql.PreparedStatement ps = db.conn.prepareStatement(sql)) {
        ps.setString(1, first);
        ps.setString(2, name);
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            TestDataDb.Column c = t.columns.get(
                String.valueOf(rs.getString(1)).toLowerCase(java.util.Locale.ROOT));
            if (c != null) {
              c.generated = true;
            }
          }
        }
      }
    } catch (Exception e) {
      // an old server without that catalog column: the insert itself will tell
    }
  }

  /** Deletes every row of a table and returns how many there were. */
  static long clear(TestDataDb db, TestDataDb.Table t) throws SQLException, TestDataFailure {
    String delete = "DELETE FROM " + t.sql;
    try (Statement st = db.conn.createStatement()) {
      try {
        return st.executeUpdate(delete);
      } catch (SQLException e) {
        // MySQL checks a foreign key row by row, so a table whose rows point at each other
        // cannot be emptied in one statement: cut those references first
        List<String> self = "mysql".equals(db.dialect) && e.getErrorCode() == 1451
            ? selfReferences(db, t) : new ArrayList<String>();
        if (self.isEmpty()) {
          throw e;
        }
        StringBuilder set = new StringBuilder();
        StringBuilder where = new StringBuilder();
        for (String column : self) {
          String c = db.quote(column);
          set.append(set.length() > 0 ? ", " : "").append(c).append(" = NULL");
          where.append(where.length() > 0 ? " OR " : "").append(c).append(" IS NOT NULL");
        }
        try {
          st.executeUpdate("UPDATE " + t.sql + " SET " + set + " WHERE " + where);
          return st.executeUpdate(delete);
        } catch (SQLException second) {
          throw e;
        }
      }
    }
  }

  /** Columns of the table that are foreign keys to the table itself. */
  private static List<String> selfReferences(TestDataDb db, TestDataDb.Table t) {
    List<String> columns = new ArrayList<String>();
    try {
      DatabaseMetaData meta = db.conn.getMetaData();
      try (ResultSet rs = meta.getImportedKeys(t.catalog, t.schema, t.name)) {
        while (rs.next()) {
          String parentCatalog = rs.getString(1);
          String parent = rs.getString(3);
          String column = rs.getString(8);
          boolean sameCatalog = parentCatalog == null || t.catalog == null
              || parentCatalog.equalsIgnoreCase(t.catalog);
          if (sameCatalog && t.name.equalsIgnoreCase(parent) && column != null
              && !columns.contains(column)) {
            columns.add(column);
          }
        }
      }
    } catch (SQLException e) {
      columns.clear();
    }
    return columns;
  }

  /** null when the identity now starts behind the highest value, else why it does not. */
  static String advanceOracleIdentity(TestDataDb db, TestDataDb.Table t, String column) {
    try (Statement st = db.conn.createStatement()) {
      st.execute("ALTER TABLE " + t.sql + " MODIFY " + db.quote(column)
          + " GENERATED AS IDENTITY (START WITH LIMIT VALUE)");
      return null;
    } catch (SQLException e) {
      return String.valueOf(e.getMessage()).trim();
    } catch (TestDataFailure e) {
      return e.getMessage();
    }
  }

  /** Index of the first row of a batch the driver says it could not write, or -1. */
  static int firstFailed(SQLException e, int size) {
    if (size == 1) {
      return 0;
    }
    if (e instanceof BatchUpdateException) {
      int[] counts = ((BatchUpdateException) e).getUpdateCounts();
      if (counts != null) {
        for (int i = 0; i < counts.length; i++) {
          if (counts[i] == Statement.EXECUTE_FAILED) {
            return i;
          }
        }
        if (counts.length < size) {
          return counts.length;
        }
      }
    }
    return -1;
  }
}
