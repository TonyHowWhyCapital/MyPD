package mypd;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** The connection of a test data tool: dialect, quoted names, table lookup and error codes. */
final class TestDataDb implements AutoCloseable {
  static final class Column {
    String name;
    int sqlType;
    String typeName;
    boolean autoIncrement;
    /** Filled by the database itself (computed column, row version): no value can be written. */
    boolean generated;
  }

  static final class Table {
    /** Quoted name, with its schema when that is needed to reach it. */
    String sql;
    String catalog;
    String schema;
    String name;
    /** Columns by lower-case name; empty when the driver reports none. */
    final Map<String, Column> columns = new LinkedHashMap<String, Column>();
  }

  private static final BigDecimal SAFE_INTEGER = new BigDecimal("9007199254740991");
  private static String secretUrl = "";
  private static String secretPassword = "";
  private static String openDialect = "";
  private static final java.util.regex.Pattern DAY =
      java.util.regex.Pattern.compile("^(\\d{4}-\\d\\d-\\d\\d)(?:[ T](\\d\\d:\\d\\d:\\d\\d))?");
  private static final java.util.regex.Pattern CLOCK =
      java.util.regex.Pattern.compile("(?:^|[ T])(\\d\\d:\\d\\d:\\d\\d)");

  final Connection conn;
  final String dialect;
  private final String quote;
  private final String catalog;
  private final String currentSchema;

  private TestDataDb(Connection conn, String dialect, String quote) {
    this.conn = conn;
    this.dialect = dialect;
    this.quote = quote;
    String c = null;
    String s = null;
    try {
      c = conn.getCatalog();
    } catch (Throwable e) {
      c = null;
    }
    try {
      s = conn.getSchema();
    } catch (Throwable e) {
      s = null;
    }
    if (s == null && "mssql".equals(dialect)) {
      // old drivers have no getSchema()
      try (java.sql.Statement st = conn.createStatement();
           ResultSet rs = st.executeQuery("SELECT SCHEMA_NAME()")) {
        s = rs.next() ? rs.getString(1) : null;
      } catch (Throwable e) {
        s = null;
      }
    }
    this.catalog = c;
    this.currentSchema = s;
    openDialect = dialect;
  }

  static TestDataDb open(Map<String, Object> p) throws TestDataFailure {
    String driver = TestDataJson.str(p, "driver_class_name");
    secretUrl = TestDataJson.str(p, "url");
    secretPassword = TestDataJson.str(p, "password");
    openDialect = TestDataErrors.dialectOfUrl(secretUrl);
    try {
      Class.forName(driver);
    } catch (Throwable e) {
      throw new TestDataFailure("DRIVER_MISSING", "The JDBC driver " + driver + " was not found");
    }
    Connection conn;
    try {
      DriverManager.setLoginTimeout(15);
      java.util.Properties props = new java.util.Properties();
      props.setProperty("user", TestDataJson.str(p, "username"));
      props.setProperty("password", secretPassword);
      if ("mysql".equals(openDialect) && "write".equals(TestDataJson.str(p, "mode"))
          && !secretUrl.contains("rewriteBatchedStatements")) {
        // one multi-row INSERT per batch instead of one round trip per row (about 10 times faster)
        props.setProperty("rewriteBatchedStatements", "true");
      }
      conn = DriverManager.getConnection(secretUrl, props);
    } catch (SQLException e) {
      String code = classify(e);
      TestDataFailure f = failure(e);
      TestDataFailure g = new TestDataFailure(
          "LOGIN_FAILED".equals(code) ? code : "CONNECT_FAILED", f.getMessage());
      g.sqlState = f.sqlState;
      g.dbCode = f.dbCode;
      throw g;
    }
    try {
      DatabaseMetaData meta = conn.getMetaData();
      String asked = TestDataJson.str(p, "dialect").toLowerCase(Locale.ROOT);
      String dialect = asked.matches("mssql|mysql|postgresql|oracle|sqlite")
          ? asked : dialectOf(meta.getDatabaseProductName());
      String q = meta.getIdentifierQuoteString();
      return new TestDataDb(conn, dialect, q == null ? "" : q.trim());
    } catch (SQLException e) {
      try {
        conn.close();
      } catch (SQLException ignored) {
        // nothing to do
      }
      throw failure(e);
    }
  }

  static String dialectOf(String product) {
    String p = product == null ? "" : product.toLowerCase(Locale.ROOT);
    if (p.contains("microsoft sql server")) {
      return "mssql";
    }
    if (p.contains("mysql") || p.contains("mariadb")) {
      return "mysql";
    }
    if (p.contains("postgresql")) {
      return "postgresql";
    }
    if (p.contains("oracle")) {
      return "oracle";
    }
    return p.contains("sqlite") ? "sqlite" : "generic";
  }

  /** Removes the JDBC url and the password from a message before it leaves the tool. */
  static String clean(String message) {
    String m = message == null ? "" : message;
    if (!secretUrl.isEmpty()) {
      m = m.replace(secretUrl, "<jdbc url>");
    }
    if (secretPassword.length() >= 4) {
      m = m.replace(secretPassword, "***");
    }
    return m.replaceAll("(?i)(password|pwd)\\s*=\\s*[^;&\\s]*", "$1=***");
  }

  static String classify(Throwable e) {
    return TestDataErrors.classify(e, openDialect);
  }

  static TestDataFailure failure(Throwable e) {
    if (e instanceof TestDataFailure) {
      return (TestDataFailure) e;
    }
    String message = e.getMessage() == null ? e.toString() : e.getMessage();
    TestDataFailure f = new TestDataFailure(classify(e), message.trim());
    if (e instanceof SQLException) {
      f.sqlState = ((SQLException) e).getSQLState();
      f.dbCode = ((SQLException) e).getErrorCode();
    }
    return f;
  }

  String quote(String name) throws TestDataFailure {
    if ("mssql".equals(dialect)) {
      return "[" + name.replace("]", "]]") + "]";
    }
    if ("mysql".equals(dialect)) {
      return "`" + name.replace("`", "``") + "`";
    }
    if (!"generic".equals(dialect)) {
      return "\"" + name.replace("\"", "\"\"") + "\"";
    }
    if (quote.isEmpty()) {
      if (!name.matches("[A-Za-z_][A-Za-z0-9_$#]*")) {
        throw new TestDataFailure("BAD_NAME", "The name " + name + " cannot be used unquoted");
      }
      return name;
    }
    return quote + name.replace(quote, quote + quote) + quote;
  }

  /** Finds a table whatever the letter case it was created with; null when it does not exist. */
  Table table(String name) throws SQLException, TestDataFailure {
    Table t = lookup(null, null, name);
    if (t == null && name.indexOf('.') > 0) {
      String[] parts = name.split("\\.");
      if (parts.length == 2) {
        t = lookup(null, parts[0], parts[1]);
      } else if (parts.length == 3) {
        t = lookup(parts[0], parts[1], parts[2]);
      }
    }
    return t;
  }

  private static Set<String> variants(String name) {
    Set<String> set = new LinkedHashSet<String>();
    set.add(name);
    if (name != null) {
      set.add(name.toUpperCase(Locale.ROOT));
      set.add(name.toLowerCase(Locale.ROOT));
    }
    return set;
  }

  private Table lookup(String cat, String schema, String name) throws SQLException, TestDataFailure {
    DatabaseMetaData meta = conn.getMetaData();
    boolean mysql = "mysql".equals(dialect);
    if (mysql && schema != null && cat == null) {
      // MySQL: `database.table`, and the driver calls the database a catalog
      cat = schema;
      schema = null;
    }
    String useCat = cat == null ? catalog : cat;
    // A name without schema is looked for in the schema in use only: a table of the same name
    // somewhere else must never be written to, let alone cleared, by accident.
    String inSchema = schema != null ? schema : currentSchema;
    List<String[]> found = new ArrayList<String[]>();
    // a database named in another letter case (MySQL on Linux tells them apart)
    Set<String> cats = cat == null ? variants(null) : variants(cat);
    for (String c : cats) {
      String oneCat = c == null ? useCat : c;
      for (String s : variants(inSchema)) {
        for (String pattern : variants(name)) {
          collect(meta, oneCat, s, pattern, name, inSchema, found);
        }
      }
      if (found.isEmpty() && (inSchema != null || oneCat != null)) {
        // created with mixed case: look through the tables of the schema
        for (String s : variants(inSchema)) {
          collect(meta, oneCat, s, "%", name, inSchema, found);
        }
      }
      if (!found.isEmpty()) {
        break;
      }
    }
    if (found.isEmpty()) {
      return null;
    }
    String[] best = found.get(0);
    int bestScore = -1;
    for (String[] f : found) {
      int score = (f[2].equals(name) ? 2 : 0)
          + (inSchema != null && inSchema.equals(f[1]) ? 1 : 0);
      if (score > bestScore) {
        best = f;
        bestScore = score;
      }
    }
    Table t = new Table();
    t.catalog = best[0];
    t.schema = best[1];
    t.name = best[2];
    StringBuilder sql = new StringBuilder();
    if (cat != null) {
      sql.append(quote(best[0] == null ? cat : best[0])).append('.');
    }
    if (!mysql && (cat != null || schema != null) && (best[1] != null || schema != null)) {
      sql.append(quote(best[1] == null ? schema : best[1])).append('.');
    }
    t.sql = sql.append(quote(best[2])).toString();
    columns(meta, t);
    return t;
  }

  private void collect(DatabaseMetaData meta, String cat, String schemaPattern, String pattern,
      String name, String schema, List<String[]> found) throws SQLException {
    ResultSet rs;
    try {
      rs = meta.getTables(cat, schemaPattern, pattern,
          new String[] {"TABLE", "VIEW", "PARTITIONED TABLE"});
    } catch (SQLException e) {
      rs = meta.getTables(cat, schemaPattern, pattern, null);
    }
    try {
      while (rs.next()) {
        String[] row = new String[] {rs.getString(1), rs.getString(2), rs.getString(3)};
        boolean same = row[2] != null && row[2].equalsIgnoreCase(name)
            && (schema == null || schema.equalsIgnoreCase(row[1]));
        boolean known = false;
        for (String[] f : found) {
          known = known || (String.valueOf(f[1]).equals(String.valueOf(row[1])) && f[2].equals(row[2]));
        }
        if (same && !known) {
          found.add(row);
        }
      }
    } finally {
      rs.close();
    }
  }

  private void columns(DatabaseMetaData meta, Table t) {
    try (ResultSet rs = meta.getColumns(t.catalog, t.schema, t.name, "%")) {
      while (rs.next()) {
        // read left to right: some drivers allow nothing else
        String table = rs.getString(3);
        Column c = new Column();
        c.name = rs.getString(4);
        c.sqlType = rs.getInt(5);
        c.typeName = rs.getString(6);
        try {
          c.autoIncrement = "YES".equalsIgnoreCase(rs.getString("IS_AUTOINCREMENT"));
        } catch (SQLException e) {
          c.autoIncrement = false;
        }
        try {
          c.generated = "YES".equalsIgnoreCase(rs.getString("IS_GENERATEDCOLUMN"));
        } catch (SQLException e) {
          c.generated = false;
        }
        // MySQL's driver also says so for a column that merely has a default expression
        c.generated = c.generated && !"mysql".equals(dialect);
        // SQL Server: a row version, called timestamp, is written by the server alone
        c.generated = c.generated || ("mssql".equals(dialect) && c.typeName != null
            && (c.typeName.equalsIgnoreCase("timestamp") || c.typeName.equalsIgnoreCase("rowversion")));
        if (c.name != null && t.name.equals(table)) {
          t.columns.put(c.name.toLowerCase(Locale.ROOT), c);
        }
      }
    } catch (SQLException e) {
      // unknown columns: the insert itself will tell
      t.columns.clear();
    }
    if (!t.columns.isEmpty()) {
      TestDataExtras.markGenerated(this, t);
    }
  }

  /** One value of a result set as JSON: number, boolean, canonical date text, hex or text. */
  String jsonValue(ResultSet rs, int index, int sqlType) throws SQLException {
    Object v;
    try {
      v = typed(rs, index, sqlType);
    } catch (SQLException e) {
      v = rs.getString(index);
    } catch (RuntimeException e) {
      v = rs.getString(index);
    }
    if (v == null || rs.wasNull()) {
      return "null";
    }
    if (v instanceof Boolean) {
      return v.toString();
    }
    if (v instanceof BigDecimal) {
      return number((BigDecimal) v);
    }
    if (v instanceof Double || v instanceof Float) {
      double d = ((Number) v).doubleValue();
      return Double.isNaN(d) || Double.isInfinite(d) ? Tool.json(v.toString()) : number(new BigDecimal(v.toString()));
    }
    if (v instanceof Number) {
      return number(new BigDecimal(v.toString()));
    }
    if (v instanceof java.sql.Timestamp) {
      return Tool.json(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format((java.util.Date) v));
    }
    if (v instanceof java.sql.Time) {
      return Tool.json(new SimpleDateFormat("HH:mm:ss").format((java.util.Date) v));
    }
    if (v instanceof java.util.Date) {
      return Tool.json(new SimpleDateFormat("yyyy-MM-dd").format((java.util.Date) v));
    }
    if (v instanceof byte[]) {
      StringBuilder sb = new StringBuilder();
      for (byte b : (byte[]) v) {
        sb.append(String.format("%02x", b & 0xff));
      }
      return Tool.json(sb.toString());
    }
    return Tool.json(v instanceof String ? (String) v : String.valueOf(rs.getString(index)));
  }

  private Object typed(ResultSet rs, int index, int sqlType) throws SQLException {
    if ("sqlite".equals(dialect)) {
      // SQLite values carry their own type whatever the column was declared as
      return rs.getObject(index);
    }
    switch (sqlType) {
      case Types.TINYINT: case Types.SMALLINT: case Types.INTEGER: case Types.BIGINT:
      case Types.NUMERIC: case Types.DECIMAL: case Types.FLOAT: case Types.REAL: case Types.DOUBLE:
        return rs.getBigDecimal(index);
      case Types.BIT: case Types.BOOLEAN:
        return rs.getBoolean(index);
      case Types.DATE: case Types.TIME: case Types.TIME_WITH_TIMEZONE:
      case Types.TIMESTAMP: case Types.TIMESTAMP_WITH_TIMEZONE: case -101: case -102: case -155:
        return temporal(rs, index, sqlType);
      case Types.BINARY: case Types.VARBINARY: case Types.LONGVARBINARY: case Types.BLOB:
        return rs.getBytes(index);
      case Types.CHAR: case Types.VARCHAR: case Types.LONGVARCHAR: case Types.NCHAR:
      case Types.NVARCHAR: case Types.LONGNVARCHAR: case Types.CLOB: case Types.NCLOB:
        return rs.getString(index);
      default:
        Object o = rs.getObject(index);
        return o == null || o instanceof Number || o instanceof Boolean || o instanceof java.util.Date
            || o instanceof byte[] ? o : rs.getString(index);
    }
  }

  /**
   * Dates and times are read as the text the database gives, never through java.util.Date:
   * that would move them by the difference between the zone of this machine and the one the
   * driver assumes for the server (serverTimezone=UTC in a MySQL url moved every DATETIME).
   */
  private Object temporal(ResultSet rs, int index, int sqlType) throws SQLException {
    boolean time = sqlType == Types.TIME || sqlType == Types.TIME_WITH_TIMEZONE;
    boolean zoned = sqlType == -155 || sqlType == -101 || sqlType == -102
        || sqlType == Types.TIMESTAMP_WITH_TIMEZONE || sqlType == Types.TIME_WITH_TIMEZONE;
    if (("mssql".equals(dialect) || "oracle".equals(dialect)) && !zoned) {
      // these drivers build their text through java.util.Date in the local zone; read with
      // a UTC calendar and printed in UTC the wall clock value comes out untouched
      java.util.TimeZone zone = java.util.TimeZone.getTimeZone("UTC");
      java.util.Calendar utc = java.util.Calendar.getInstance(zone);
      java.util.Date d = time ? rs.getTime(index, utc)
          : (sqlType == Types.DATE ? (java.util.Date) rs.getDate(index, utc) : rs.getTimestamp(index, utc));
      if (d == null) {
        return null;
      }
      SimpleDateFormat f = new SimpleDateFormat(
          time ? "HH:mm:ss" : (sqlType == Types.DATE ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm:ss"));
      f.setTimeZone(zone);
      return f.format(d);
    }
    String text = rs.getString(index);
    if (text == null) {
      return null;
    }
    java.util.regex.Matcher m = (time ? CLOCK : DAY).matcher(text.trim());
    if (m.find()) {
      if (time) {
        return m.group(1);
      }
      if (sqlType == Types.DATE) {
        return m.group(1);
      }
      return m.group(1) + " " + (m.group(2) == null ? "00:00:00" : m.group(2));
    }
    if (time) {
      return rs.getTime(index);
    }
    return sqlType == Types.DATE ? (Object) rs.getDate(index) : rs.getTimestamp(index);
  }

  /** Integers beyond what JavaScript holds exactly, and long decimals, travel as text. */
  static String number(BigDecimal n) {
    BigDecimal plain = n.signum() == 0 ? BigDecimal.ZERO : n.stripTrailingZeros();
    if (plain.scale() <= 0) {
      return plain.abs().compareTo(SAFE_INTEGER) <= 0
          ? plain.toBigInteger().toString() : Tool.json(plain.toBigInteger().toString());
    }
    return plain.precision() <= 15 ? plain.toPlainString() : Tool.json(plain.toPlainString());
  }

  @Override
  public void close() {
    try {
      conn.close();
    } catch (SQLException e) {
      // closing is best effort
    }
  }
}
