package mypd;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Savepoint;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Writes a bundle (manifest.json + one NDJSON file per table, parents first) into the database.
 * onError=rollback: one transaction, the first failing row undoes everything and is reported.
 * onError=skip: every batch is committed; a failing batch is split until the bad rows are found,
 * which are skipped and reported.
 */
final class TestDataWrite {
  private static final int MAX_ERRORS = 100;

  private static final class Target {
    String name;
    TestDataDb.Table table;
    Path file;
    long rows;
    boolean identityInsert;
    final List<TestDataBind.Spec> specs = new ArrayList<TestDataBind.Spec>();
    final List<String> sequenceColumns = new ArrayList<String>();
    /** Auto increment columns that get explicit values, by the database or by the model. */
    final List<String> autoColumns = new ArrayList<String>();
    boolean explicitAuto;
    String insertSql;
    long written;
    long failed;
    long deleted = -1;
    final List<String> errors = new ArrayList<String>();
    final List<String> warnings = new ArrayList<String>();
  }

  private final TestDataDb db;
  private final Connection conn;
  private final Path dir;
  private final boolean skip;
  private final boolean clear;
  private final int batchSize;
  private final String progressFile;
  private final List<Target> targets = new ArrayList<Target>();
  private boolean savepoints = true;
  private boolean release = true;
  private long lastProgress;

  TestDataWrite(TestDataDb db, Map<String, Object> p) {
    this.db = db;
    this.conn = db.conn;
    this.dir = Paths.get(TestDataJson.str(p, "dir"));
    this.skip = "skip".equals(TestDataJson.str(p, "onError"));
    this.clear = "clear".equals(TestDataJson.str(p, "existing"));
    this.batchSize = (int) Math.max(1, Math.min(1000, TestDataJson.num(p, "batchSize", 500)));
    this.progressFile = TestDataJson.str(p, "progress");
  }

  String run() throws Exception {
    load();
    conn.setAutoCommit(false);
    try {
      for (Target t : targets) {
        if (t.explicitAuto) {
          TestDataExtras.keepZero(db);
          break;
        }
      }
      if (clear) {
        clearAll();
      }
      for (int i = 0; i < targets.size(); i++) {
        insert(i);
      }
      conn.commit();
      advanceIdentities();
    } catch (Throwable e) {
      try {
        conn.rollback();
      } catch (SQLException ignored) {
        // the connection may be gone; the database rolls back by itself then
      }
      TestDataFailure f = TestDataDb.failure(e);
      if (skip) {
        // what was committed before the failure stays; say how far it went
        f.tables = tablesJson();
      }
      throw f;
    }
    return "{\"dialect\":" + Tool.json(db.dialect) + ",\"tables\":" + tablesJson() + "}";
  }

  /** Reads the manifest and checks every table, column and file before anything is changed. */
  private void load() throws Exception {
    Map<String, Object> manifest;
    try {
      byte[] bytes = Files.readAllBytes(dir.resolve("manifest.json"));
      manifest = TestDataJson.object(
          TestDataJson.parse(new String(bytes, StandardCharsets.UTF_8)), "manifest.json");
    } catch (IOException e) {
      throw new TestDataFailure("BUNDLE_INVALID", "manifest.json cannot be read in " + dir);
    } catch (IllegalArgumentException e) {
      throw new TestDataFailure("BUNDLE_INVALID", "manifest.json: " + e.getMessage());
    }
    if (TestDataJson.num(manifest, "version", 0) != 1) {
      throw new TestDataFailure("BUNDLE_INVALID", "Unsupported bundle version");
    }
    List<String> missing = new ArrayList<String>();
    for (Object o : TestDataJson.list(manifest.get("tables"), "manifest.tables")) {
      Map<String, Object> m = TestDataJson.object(o, "A table of the manifest");
      Target t = new Target();
      t.name = TestDataJson.str(m, "name");
      t.rows = TestDataJson.num(m, "rows", 0);
      t.identityInsert = Boolean.TRUE.equals(m.get("identityInsert"));
      String file = TestDataJson.str(m, "file");
      if (!file.isEmpty()) {
        if (file.contains("/") || file.contains("\\") || file.contains("..")) {
          throw new TestDataFailure("BUNDLE_INVALID", "Bad file name in the manifest: " + file);
        }
        t.file = dir.resolve(file);
        if (!Files.isRegularFile(t.file)) {
          throw new TestDataFailure("BUNDLE_INVALID", "The file " + file + " is missing").at(t.name, -1);
        }
      }
      t.table = db.table(t.name);
      targets.add(t);
      if (t.table == null) {
        missing.add(t.name);
        continue;
      }
      columns(t, TestDataJson.list(m.get("columns"), "columns of " + t.name));
    }
    if (!missing.isEmpty()) {
      throw new TestDataFailure("TABLE_MISSING",
          "These tables do not exist in the database: " + join(missing)).at(missing.get(0), -1);
    }
  }

  private void columns(Target t, List<Object> columns) throws Exception {
    List<String> names = new ArrayList<String>();
    List<String> marks = new ArrayList<String>();
    List<String> unknown = new ArrayList<String>();
    List<String> fixed = new ArrayList<String>();
    for (Object o : columns) {
      Map<String, Object> m = TestDataJson.object(o, "A column of " + t.name);
      String name = TestDataJson.str(m, "name");
      TestDataDb.Column col = t.table.columns.get(name.toLowerCase(Locale.ROOT));
      if (col == null && !t.table.columns.isEmpty()) {
        unknown.add(name);
        continue;
      }
      if (col != null && col.generated) {
        fixed.add(name);
        continue;
      }
      boolean auto = col == null ? Boolean.TRUE.equals(m.get("autoIncrement")) : col.autoIncrement;
      String actual = col == null ? name : col.name;
      if (auto) {
        t.sequenceColumns.add(actual);
      }
      if (auto || Boolean.TRUE.equals(m.get("autoIncrement"))) {
        t.explicitAuto = true;
        t.autoColumns.add(actual);
      }
      TestDataBind.Spec spec = TestDataBind.spec(name, TestDataJson.str(m, "kind"), col, db.dialect);
      t.specs.add(spec);
      names.add(db.quote(actual));
      marks.add(spec.mark);
    }
    if (!unknown.isEmpty()) {
      throw new TestDataFailure("COLUMN_MISSING",
          "The table " + t.name + " has no column " + join(unknown)).at(t.name, -1);
    }
    if (!fixed.isEmpty()) {
      throw new TestDataFailure("COLUMN_NOT_WRITABLE", "The database fills these columns of "
          + t.name + " itself (computed column or row version), no value can be written: "
          + join(fixed)).at(t.name, -1);
    }
    if (!names.isEmpty()) {
      String overriding = t.explicitAuto && TestDataExtras.pgAlwaysIdentity(db, t.table)
          ? " OVERRIDING SYSTEM VALUE" : "";
      t.insertSql = "INSERT INTO " + t.table.sql + " (" + join(names) + ")" + overriding
          + " VALUES (" + join(marks) + ")";
    } else if ("mysql".equals(db.dialect)) {
      t.insertSql = "INSERT INTO " + t.table.sql + " () VALUES ()";
    } else {
      t.insertSql = "INSERT INTO " + t.table.sql + " DEFAULT VALUES";
    }
  }

  /** Children first: the manifest lists parents first. */
  private void clearAll() throws Exception {
    for (int i = targets.size() - 1; i >= 0; i--) {
      Target t = targets.get(i);
      progress(i, "clear", true);
      try {
        t.deleted = TestDataExtras.clear(db, t.table);
      } catch (SQLException e) {
        throw TestDataDb.failure(e).at(t.name, -1);
      }
    }
    if (skip) {
      conn.commit();
    }
  }

  private void insert(int index) throws Exception {
    Target t = targets.get(index);
    progress(index, "insert", true);
    // SQL Server takes explicit identity values only while this is on, one table at a time
    boolean identity = t.identityInsert && "mssql".equals(db.dialect) && !t.sequenceColumns.isEmpty();
    if (identity) {
      execute("SET IDENTITY_INSERT " + t.table.sql + " ON");
    }
    try {
      if (t.file != null) {
        readRows(t, index);
      }
    } finally {
      if (identity) {
        try {
          execute("SET IDENTITY_INSERT " + t.table.sql + " OFF");
        } catch (SQLException e) {
          // the session ends with the tool anyway
        }
      }
    }
    if (skip) {
      conn.commit();
    }
    if (t.written > 0 && "postgresql".equals(db.dialect)) {
      resetSequences(t);
    }
    progress(index, "insert", true);
  }

  /**
   * Oracle: an identity column does not follow explicit values. Moving it is DDL, which
   * commits, so it happens after the data is safe. A column fed by a sequence and a trigger
   * cannot be moved from here and is reported.
   */
  private void advanceIdentities() {
    if (!"oracle".equals(db.dialect)) {
      return;
    }
    for (Target t : targets) {
      for (String column : t.written > 0 ? t.autoColumns : new ArrayList<String>()) {
        String problem = TestDataExtras.advanceOracleIdentity(db, t.table, column);
        if (problem != null) {
          t.warnings.add("{\"code\":\"IDENTITY_NOT_ADVANCED\",\"message\":" + Tool.json(
              "Explicit values were written to the auto increment column " + column
                  + "; its sequence or identity was not moved past them ("
                  + TestDataDb.clean(problem) + ")") + "}");
        }
      }
    }
  }

  private void execute(String sql) throws SQLException {
    try (Statement st = conn.createStatement()) {
      st.execute(sql);
    }
  }

  private void readRows(Target t, int index) throws Exception {
    List<Object[]> rows = new ArrayList<Object[]>(batchSize);
    long[] numbers = new long[batchSize];
    long rowNumber = 0;
    try (BufferedReader reader = Files.newBufferedReader(t.file, StandardCharsets.UTF_8);
         PreparedStatement ps = conn.prepareStatement(t.insertSql)) {
      String line;
      while ((line = reader.readLine()) != null) {
        if (line.trim().isEmpty() || line.trim().equals("﻿")) {
          continue;
        }
        rowNumber++;
        Object[] row;
        try {
          row = convert(t, line);
        } catch (IllegalArgumentException e) {
          rowFailed(t, rowNumber, new TestDataFailure("BAD_VALUE", e.getMessage()));
          continue;
        }
        numbers[rows.size()] = rowNumber;
        rows.add(row);
        if (rows.size() == batchSize) {
          insertRange(t, ps, rows, numbers, 0, rows.size());
          rows.clear();
          progress(index, "insert", false);
        }
      }
      if (!rows.isEmpty()) {
        insertRange(t, ps, rows, numbers, 0, rows.size());
      }
    } catch (IOException e) {
      throw new TestDataFailure("BUNDLE_INVALID",
          "Cannot read " + t.file.getFileName() + ": " + e).at(t.name, rowNumber + 1);
    }
  }

  private Object[] convert(Target t, String line) {
    Object parsed = TestDataJson.parse(line);
    if (!(parsed instanceof List)) {
      throw new IllegalArgumentException("The line is not a JSON array");
    }
    List<?> values = (List<?>) parsed;
    if (values.size() != t.specs.size()) {
      throw new IllegalArgumentException(
          "The line has " + values.size() + " values for " + t.specs.size() + " columns");
    }
    Object[] row = new Object[values.size()];
    for (int i = 0; i < row.length; i++) {
      row[i] = TestDataBind.convert(values.get(i), t.specs.get(i));
    }
    return row;
  }

  /** Inserts rows lo..hi-1 as one batch; on failure halves the range until the bad rows are alone. */
  private void insertRange(Target t, PreparedStatement ps, List<Object[]> rows, long[] numbers,
      int lo, int hi) throws Exception {
    Savepoint sp = null;
    if (!skip && savepoints) {
      try {
        sp = conn.setSavepoint();
      } catch (SQLException e) {
        savepoints = false;
      }
    }
    try {
      for (int k = lo; k < hi; k++) {
        Object[] row = rows.get(k);
        for (int c = 0; c < row.length; c++) {
          TestDataBind.set(ps, c + 1, row[c], t.specs.get(c));
        }
        if (hi - lo > 1) {
          ps.addBatch();
        }
      }
      if (hi - lo > 1) {
        ps.executeBatch();
      } else {
        ps.executeUpdate();
      }
      if (skip) {
        conn.commit();
      } else if (sp != null && release) {
        try {
          conn.releaseSavepoint(sp);
        } catch (SQLException e) {
          // SQL Server and Oracle have no release; the savepoints go with the transaction
          release = false;
        }
      }
      t.written += hi - lo;
    } catch (SQLException e) {
      try {
        ps.clearBatch();
      } catch (SQLException ignored) {
        // nothing to clear
      }
      if (skip) {
        conn.rollback();
      } else if (!undo(sp)) {
        // the batch cannot be replayed: name the row the driver points at
        int at = TestDataExtras.firstFailed(e, hi - lo);
        TestDataFailure f = TestDataDb.failure(e);
        String note = at < 0 ? " (somewhere in rows " + numbers[lo] + "-" + numbers[hi - 1] + ")" : "";
        throw new TestDataFailure(f.code, f.getMessage() + note).at(t.name, numbers[lo + Math.max(at, 0)]);
      }
      if (hi - lo == 1) {
        rowFailed(t, numbers[lo], TestDataDb.failure(e));
      } else {
        int mid = (lo + hi) >>> 1;
        insertRange(t, ps, rows, numbers, lo, mid);
        insertRange(t, ps, rows, numbers, mid, hi);
      }
    }
  }

  private boolean undo(Savepoint sp) {
    if (sp == null) {
      return false;
    }
    try {
      conn.rollback(sp);
      return true;
    } catch (SQLException e) {
      return false;
    }
  }

  private void rowFailed(Target t, long row, TestDataFailure f) throws TestDataFailure {
    if (!skip) {
      TestDataFailure g = new TestDataFailure(f.code, f.getMessage()).at(t.name, row);
      g.sqlState = f.sqlState;
      g.dbCode = f.dbCode;
      throw g;
    }
    t.failed++;
    if (t.errors.size() < MAX_ERRORS) {
      t.errors.add("{\"row\":" + row + ",\"code\":" + Tool.json(f.code) + ",\"message\":"
          + Tool.json(TestDataDb.clean(f.getMessage())) + "}");
    }
  }

  /** PostgreSQL: move the sequence of serial/identity columns past the explicit values. */
  private void resetSequences(Target t) throws Exception {
    for (String column : t.sequenceColumns) {
      String max = "(SELECT MAX(" + db.quote(column) + ") FROM " + t.table.sql + ")";
      String sql = "SELECT setval(pg_get_serial_sequence(?, ?), COALESCE(" + max + ", 1), "
          + max + " IS NOT NULL)";
      Savepoint sp = skip ? null : conn.setSavepoint();
      try (PreparedStatement ps = conn.prepareStatement(sql)) {
        ps.setString(1, t.table.sql);
        ps.setString(2, column);
        ps.execute();
        if (skip) {
          conn.commit();
        }
      } catch (SQLException e) {
        if (skip) {
          conn.rollback();
        } else {
          conn.rollback(sp);
        }
        t.warnings.add("{\"code\":\"SEQUENCE_NOT_RESET\",\"message\":"
            + Tool.json(TestDataDb.clean(column + ": " + e.getMessage())) + "}");
      }
    }
  }

  private void progress(int index, String phase, boolean force) {
    long now = System.currentTimeMillis();
    if (progressFile.isEmpty() || (!force && now - lastProgress < 250)) {
      return;
    }
    lastProgress = now;
    Target t = targets.get(index);
    String json = "{\"table\":" + Tool.json(t.name) + ",\"done\":" + (t.written + t.failed)
        + ",\"total\":" + t.rows + ",\"tableIndex\":" + index + ",\"tableCount\":" + targets.size()
        + ",\"phase\":" + Tool.json(phase) + ",\"written\":" + t.written
        + ",\"failed\":" + t.failed + "}";
    try {
      // written beside and renamed so that a reader never sees half a file
      Path target = Paths.get(progressFile);
      Path temp = Paths.get(progressFile + ".tmp");
      Files.write(temp, json.getBytes(StandardCharsets.UTF_8));
      try {
        Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
      } catch (IOException e) {
        Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
      }
    } catch (IOException e) {
      // progress is a courtesy; the write goes on
    }
  }

  private String tablesJson() {
    StringBuilder sb = new StringBuilder("[");
    for (Target t : targets) {
      sb.append(sb.length() > 1 ? "," : "").append("{\"name\":").append(Tool.json(t.name))
          .append(",\"written\":").append(t.written).append(",\"failed\":").append(t.failed)
          .append(",\"deleted\":").append(t.deleted < 0 ? "null" : String.valueOf(t.deleted))
          .append(",\"errors\":[").append(join(t.errors)).append("]")
          .append(",\"warnings\":[").append(join(t.warnings)).append("]}");
    }
    return sb.append(']').toString();
  }

  private static String join(List<String> parts) {
    StringBuilder sb = new StringBuilder();
    for (String p : parts) {
      sb.append(sb.length() > 0 ? "," : "").append(p);
    }
    return sb.toString();
  }
}
