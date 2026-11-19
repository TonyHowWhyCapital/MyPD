package mypd;

import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Map;

/**
 * ddl mode of TestData: runs DDL statements, already split by the caller, in their order.
 * Where the database can undo DDL (transactional) they run in one transaction that is rolled
 * back when one fails; elsewhere every statement commits at once and the run stops at the
 * first failure. Progress: {"done":n,"total":m}. Result: {"executed":n,"transactional":bool}.
 * A failure also carries index (the failing statement, from 0), executed and rolledBack.
 */
final class ApplyDdl {
  private ApplyDdl() {
  }

  /** Whether DDL of the dialect can be rolled back; MySQL and Oracle commit it implicitly. */
  static boolean transactional(String dialect) {
    switch (dialect) {
      case "postgresql":
      case "mssql":
      case "sqlite":
        return true;
      case "mysql":
      case "oracle":
      default:
        return false;
    }
  }

  static String run(TestDataDb db, Map<String, Object> p) throws Exception {
    List<Object> statements = TestDataJson.list(p.get("statements"), "statements");
    if (statements.isEmpty()) {
      throw new TestDataFailure("BAD_PARAMS", "No statements to execute");
    }
    String progressFile = TestDataJson.str(p, "progress");
    boolean tx = transactional(db.dialect);
    int total = statements.size();
    int done = 0;
    db.conn.setAutoCommit(!tx);
    try (Statement st = db.conn.createStatement()) {
      for (Object statement : statements) {
        try {
          st.execute(String.valueOf(statement));
        } catch (SQLException e) {
          throw failed(db, tx, e, done, done);
        }
        done++;
        Tool.progress(progressFile, "{\"done\":" + done + ",\"total\":" + total + "}");
      }
      if (tx) {
        try {
          db.conn.commit();
        } catch (SQLException e) {
          throw failed(db, true, e, -1, 0);
        }
      }
    }
    return "{\"executed\":" + done + ",\"transactional\":" + tx + "}";
  }

  private static TestDataFailure failed(TestDataDb db, boolean tx, SQLException e, int index,
      int done) {
    boolean rolledBack = false;
    if (tx) {
      try {
        db.conn.rollback();
        rolledBack = true;
      } catch (SQLException ignored) {
        // the connection is closed next; PostgreSQL, SQL Server and SQLite then drop the
        // transaction that was never committed
        rolledBack = true;
      }
    }
    TestDataFailure f = TestDataDb.failure(e);
    f.index = index;
    f.executed = rolledBack ? 0 : done;
    f.rolledBack = rolledBack;
    return f;
  }
}
