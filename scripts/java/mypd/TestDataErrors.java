package mypd;

import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.util.Locale;

/**
 * Stable codes for what a database answers. The vendor's own error number decides first
 * (SQL Server reports most errors with states like S0001, MySQL files "out of range" and
 * "incorrect value" under the state of "too long"), the SQL state after that.
 */
final class TestDataErrors {
  private TestDataErrors() {
  }

  /** Before the connection exists (a failed login) only the url tells which database it is. */
  static String dialectOfUrl(String url) {
    String u = url == null ? "" : url.toLowerCase(Locale.ROOT);
    if (u.startsWith("jdbc:sqlserver:") || u.startsWith("jdbc:jtds:")) {
      return "mssql";
    }
    if (u.startsWith("jdbc:mysql:") || u.startsWith("jdbc:mariadb:")) {
      return "mysql";
    }
    if (u.startsWith("jdbc:postgresql:")) {
      return "postgresql";
    }
    return u.startsWith("jdbc:oracle:") ? "oracle" : "";
  }

  /**
   * For the tests: reads a JSON array of {dialect, state, code, message, timeout} and writes
   * the code each one is given.
   */
  public static void main(String[] args) throws Exception {
    String text = new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(args[0])),
        java.nio.charset.StandardCharsets.UTF_8);
    StringBuilder sb = new StringBuilder("[");
    for (Object o : TestDataJson.list(TestDataJson.parse(text), "cases")) {
      java.util.Map<String, Object> m = TestDataJson.object(o, "case");
      String state = m.get("state") == null ? null : TestDataJson.str(m, "state");
      int code = (int) TestDataJson.num(m, "code", 0);
      String message = TestDataJson.str(m, "message");
      SQLException e = Boolean.TRUE.equals(m.get("timeout"))
          ? new SQLTimeoutException(message, state, code) : new SQLException(message, state, code);
      sb.append(sb.length() > 1 ? "," : "")
          .append(Tool.json(classify(e, TestDataJson.str(m, "dialect"))));
    }
    java.nio.file.Files.write(java.nio.file.Paths.get(args[1]),
        sb.append(']').toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
  }

  static String classify(Throwable e, String dialect) {
    if (e instanceof ClassNotFoundException || e instanceof NoClassDefFoundError) {
      return "DRIVER_MISSING";
    }
    if (!(e instanceof SQLException)) {
      return "TOOL_ERROR";
    }
    SQLException s = (SQLException) e;
    String state = s.getSQLState() == null ? "" : s.getSQLState();
    int c = s.getErrorCode();
    String m = String.valueOf(s.getMessage()).toLowerCase(Locale.ROOT);
    if (e instanceof SQLTimeoutException || state.equals("HYT00") || state.equals("HY008")
        || state.equals("57014")) {
      return "TIMEOUT";
    }
    String byVendor = null;
    if ("mssql".equals(dialect)) {
      byVendor = mssql(c);
    } else if ("mysql".equals(dialect)) {
      byVendor = mysql(c);
    } else if ("oracle".equals(dialect) || m.contains("ora-")) {
      byVendor = oracle(c, m);
    }
    if (byVendor != null) {
      return byVendor;
    }
    if (state.startsWith("28") || c == 18456) {
      return "LOGIN_FAILED";
    }
    if (state.startsWith("08")) {
      return "CONNECT_FAILED";
    }
    if (state.equals("22001")) {
      return "VALUE_TOO_LONG";
    }
    if (state.equals("22003")) {
      return "VALUE_OUT_OF_RANGE";
    }
    if (state.startsWith("22")) {
      return "BAD_VALUE";
    }
    if (state.startsWith("23") || m.contains("sqlite_constraint")) {
      return "CONSTRAINT";
    }
    if (state.equals("42501")) {
      return "PERMISSION_DENIED";
    }
    // SQLite has neither states nor numbers that tell these apart, only its wording
    boolean lite = m.contains("[sqlite_error]");
    if (state.equals("42601") || (lite && (m.contains("syntax error")
        || m.contains("incomplete input")))) {
      return "SQL_SYNTAX";
    }
    if (state.equals("42P01") || state.equals("42S02") || (lite && m.contains("no such table"))) {
      return "TABLE_MISSING";
    }
    if (state.equals("42703") || state.equals("42S22") || (lite && m.contains("no such column"))) {
      return "COLUMN_MISSING";
    }
    if (state.startsWith("42") || state.startsWith("S0") || state.startsWith("3F")) {
      return "SQL_ERROR";
    }
    return "DB_ERROR";
  }

  private static boolean in(int c, int... codes) {
    for (int code : codes) {
      if (c == code) {
        return true;
      }
    }
    return false;
  }

  private static String mssql(int c) {
    if (c == 18456) {
      return "LOGIN_FAILED";
    }
    if (in(c, 102, 105, 156, 170, 319, 1018)) {
      return "SQL_SYNTAX";
    }
    if (c == 208) {
      return "TABLE_MISSING";
    }
    if (in(c, 207, 4104)) {
      return "COLUMN_MISSING";
    }
    if (in(c, 2628, 8152)) {
      return "VALUE_TOO_LONG";
    }
    if (in(c, 220, 232, 244, 248, 1007, 8115)) {
      return "VALUE_OUT_OF_RANGE";
    }
    if (in(c, 241, 242, 245, 295, 296, 517, 8114, 8169, 9420, 13609)) {
      return "BAD_VALUE";
    }
    if (in(c, 515, 544, 545, 547, 2601, 2627, 8101)) {
      return "CONSTRAINT";
    }
    if (in(c, 229, 230, 262, 300, 916, 1088, 3704)) {
      return "PERMISSION_DENIED";
    }
    return null;
  }

  private static String mysql(int c) {
    if (in(c, 1045, 1698)) {
      return "LOGIN_FAILED";
    }
    if (in(c, 1064, 1149)) {
      return "SQL_SYNTAX";
    }
    if (in(c, 1146, 1051)) {
      return "TABLE_MISSING";
    }
    if (c == 1054) {
      return "COLUMN_MISSING";
    }
    if (c == 1406) {
      return "VALUE_TOO_LONG";
    }
    if (in(c, 1264, 1690)) {
      return "VALUE_OUT_OF_RANGE";
    }
    if (in(c, 1265, 1292, 1366, 1367, 1411, 1416, 3140)) {
      return "BAD_VALUE";
    }
    if (in(c, 1048, 1062, 1216, 1217, 1364, 1451, 1452, 3819)) {
      return "CONSTRAINT";
    }
    if (in(c, 1044, 1142, 1143, 1227, 1370)) {
      return "PERMISSION_DENIED";
    }
    if (in(c, 1317, 3024)) {
      return "TIMEOUT";
    }
    return null;
  }

  private static String oracle(int c, String m) {
    if (c == 1017 || m.contains("ora-01017")) {
      return "LOGIN_FAILED";
    }
    if (c == 1013) {
      return "TIMEOUT";
    }
    if (c == 12899 || m.contains("ora-12899")) {
      return "VALUE_TOO_LONG";
    }
    if (in(c, 1438, 1426, 1455)) {
      return "VALUE_OUT_OF_RANGE";
    }
    if (c == 1722 || c == 1858 || c == 1861 || c == 932 || (c >= 1830 && c <= 1850)
        || c == 40441) {
      return "BAD_VALUE";
    }
    if (in(c, 1, 1400, 2290, 2291, 2292, 32795)) {
      return "CONSTRAINT";
    }
    if (in(c, 1031, 1950, 41900)) {
      return "PERMISSION_DENIED";
    }
    if (c == 942) {
      return "TABLE_MISSING";
    }
    if (c == 904) {
      return "COLUMN_MISSING";
    }
    // ORA-009xx is the family of statements the parser refuses; the few that are about
    // something else (ambiguous column, grouping, a name in use, a broken synonym) stay general
    if (c >= 900 && c <= 999 && !in(c, 918, 937, 955, 959, 979, 980, 988, 990, 997, 998)) {
      return "SQL_SYNTAX";
    }
    return null;
  }
}
