package mypd;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Types;
import java.util.Locale;

/** Turns the values of a bundle line into what a PreparedStatement takes, by column kind. */
final class TestDataBind {
  /** How one column of the insert is bound. */
  static final class Spec {
    String name;
    String kind;
    int nullType;
    boolean nString;
    boolean boolAsInt;
    boolean pgOther;
    /**
     * How dates and times are sent. Never as java.sql.Timestamp where it can be avoided: that
     * type is a moment in the zone of this machine, so a driver that assumes another zone for
     * the server moves the value (serverTimezone=UTC in a MySQL url: every DATETIME off by the
     * local offset), and a wall clock time that the local zone skipped for daylight saving
     * cannot even be built. TEXT: canonical text (MySQL, SQLite). UNTYPED: text the server
     * reads as a literal of the column's type (PostgreSQL). MSSQL: text in the formats SQL
     * Server reads the same under any language and DATEFORMAT. Oracle: canonical text inside
     * TO_TIMESTAMP / TO_DATE with a fixed format (see `mark`), so NLS_DATE_FORMAT plays no
     * part. LEGACY: java.sql types, for databases this tool does not know.
     */
    int temporal;
    /** The placeholder of the column in the INSERT. */
    String mark = "?";
    /** Put before a time of day where the column holds a full date (Oracle). */
    String timePrefix = "";
    /** SQL Server datetime and smalldatetime take three fraction digits at most. */
    int fraction = 9;
  }

  static final int LEGACY = 0;
  static final int TEXT = 1;
  static final int UNTYPED = 2;
  static final int MSSQL = 3;

  private TestDataBind() {
  }

  static Spec spec(String name, String kind, TestDataDb.Column col, String dialect) {
    Spec s = new Spec();
    s.name = name;
    s.kind = kind == null ? "string" : kind;
    // a character column takes everything as text, whatever the model says it is
    // (not on SQLite, whose driver reports DATE and the like as character columns)
    if (col != null && isChar(col.sqlType) && !"binary".equals(s.kind) && !"sqlite".equals(dialect)) {
      s.kind = "string";
    }
    s.nullType = col != null && usableForNull(col.sqlType) ? col.sqlType : defaultType(s.kind, dialect);
    s.nString = "mssql".equals(dialect);
    if ("sqlite".equals(dialect) || "mysql".equals(dialect)) {
      s.temporal = TEXT;
    } else if ("postgresql".equals(dialect)) {
      s.temporal = UNTYPED;
    } else if ("mssql".equals(dialect)) {
      s.temporal = MSSQL;
      String type = col == null || col.typeName == null ? "" : col.typeName.toLowerCase(Locale.ROOT);
      s.fraction = type.equals("datetime") ? 3 : (type.equals("smalldatetime") ? 0 : 7);
    } else if ("oracle".equals(dialect) && isTemporal(s.kind)) {
      s.temporal = TEXT;
      s.nullType = Types.VARCHAR;
      // Oracle has no time of day: such a column is a DATE on 1970-01-01, as in the script
      s.mark = "date".equals(s.kind) ? "TO_DATE(?, 'YYYY-MM-DD')"
          : ("time".equals(s.kind) ? "TO_DATE(?, 'YYYY-MM-DD HH24:MI:SS')"
              : "TO_TIMESTAMP(?, 'YYYY-MM-DD HH24:MI:SS.FF')");
      s.timePrefix = "1970-01-01 ";
    }
    s.pgOther = "postgresql".equals(dialect) && col != null && col.sqlType == Types.OTHER;
    if (col != null) {
      s.boolAsInt = col.sqlType != Types.BIT && col.sqlType != Types.BOOLEAN;
    } else {
      s.boolAsInt = "oracle".equals(dialect);
    }
    return s;
  }

  private static boolean isChar(int t) {
    return t == Types.CHAR || t == Types.VARCHAR || t == Types.LONGVARCHAR || t == Types.NCHAR
        || t == Types.NVARCHAR || t == Types.LONGNVARCHAR || t == Types.CLOB || t == Types.NCLOB;
  }

  private static boolean usableForNull(int t) {
    return t != Types.ARRAY && t != Types.STRUCT && t != Types.DISTINCT && t != Types.REF
        && t != Types.JAVA_OBJECT && t != Types.NULL;
  }

  private static int defaultType(String kind, String dialect) {
    if ("int".equals(kind)) {
      return "oracle".equals(dialect) ? Types.NUMERIC : Types.BIGINT;
    }
    if ("decimal".equals(kind)) {
      return "oracle".equals(dialect) ? Types.NUMERIC : Types.DECIMAL;
    }
    if ("date".equals(kind)) {
      return Types.DATE;
    }
    if ("datetime".equals(kind)) {
      return Types.TIMESTAMP;
    }
    if ("time".equals(kind)) {
      return Types.TIME;
    }
    if ("bool".equals(kind)) {
      if ("oracle".equals(dialect)) {
        return Types.NUMERIC;
      }
      return "mssql".equals(dialect) ? Types.BIT : Types.BOOLEAN;
    }
    if ("binary".equals(kind)) {
      return Types.VARBINARY;
    }
    return "mssql".equals(dialect) ? Types.NVARCHAR : Types.VARCHAR;
  }

  /** The value in the form set() takes. Throws IllegalArgumentException for a value that does not fit. */
  static Object convert(Object v, Spec s) {
    if (v == null) {
      return null;
    }
    String kind = s.kind;
    if ("int".equals(kind)) {
      BigDecimal n = number(v, s);
      BigInteger whole;
      try {
        whole = n.toBigIntegerExact();
      } catch (ArithmeticException e) {
        throw bad(v, s, "is not a whole number");
      }
      return whole.bitLength() < 64 ? (Object) Long.valueOf(whole.longValue()) : new BigDecimal(whole);
    }
    if ("decimal".equals(kind)) {
      return number(v, s);
    }
    if ("bool".equals(kind)) {
      return bool(v, s);
    }
    String text = v instanceof BigDecimal ? ((BigDecimal) v).toPlainString() : String.valueOf(v);
    if ("date".equals(kind)) {
      String d = date(text.trim(), v, s);
      if (s.temporal == LEGACY) {
        return java.sql.Date.valueOf(d);
      }
      return s.temporal == MSSQL ? d.replace("-", "") : d;
    }
    if ("datetime".equals(kind)) {
      String d = dateTime(text.trim(), v, s);
      if (s.temporal == LEGACY) {
        return java.sql.Timestamp.valueOf(d);
      }
      return s.temporal == MSSQL ? cut(d.replace(' ', 'T'), s.fraction) : d;
    }
    if ("time".equals(kind)) {
      String t = time(text.trim(), v, s);
      if (s.temporal == LEGACY) {
        return java.sql.Time.valueOf(t);
      }
      return s.timePrefix + t;
    }
    if ("binary".equals(kind)) {
      return bytes(text.trim(), v, s);
    }
    if (v instanceof Boolean) {
      return ((Boolean) v).booleanValue() ? "1" : "0";
    }
    return text;
  }

  static void set(PreparedStatement ps, int index, Object c, Spec s) throws SQLException {
    if (c == null) {
      ps.setNull(index, s.nullType);
    } else if (c instanceof Long) {
      ps.setLong(index, ((Long) c).longValue());
    } else if (c instanceof BigDecimal) {
      ps.setBigDecimal(index, (BigDecimal) c);
    } else if (c instanceof Boolean) {
      if (s.boolAsInt) {
        ps.setInt(index, ((Boolean) c).booleanValue() ? 1 : 0);
      } else {
        ps.setBoolean(index, ((Boolean) c).booleanValue());
      }
    } else if (s.temporal == UNTYPED && isTemporal(s.kind)) {
      ps.setObject(index, c, Types.OTHER);
    } else if (c instanceof java.sql.Date) {
      ps.setDate(index, (java.sql.Date) c);
    } else if (c instanceof java.sql.Timestamp) {
      ps.setTimestamp(index, (java.sql.Timestamp) c);
    } else if (c instanceof java.sql.Time) {
      ps.setTime(index, (java.sql.Time) c);
    } else if (c instanceof byte[]) {
      ps.setBytes(index, (byte[]) c);
    } else if (s.pgOther) {
      // uuid, json and the like: let PostgreSQL convert the text itself
      ps.setObject(index, c, Types.OTHER);
    } else if (s.nString) {
      ps.setNString(index, (String) c);
    } else {
      ps.setString(index, (String) c);
    }
  }

  private static boolean isTemporal(String kind) {
    return "date".equals(kind) || "datetime".equals(kind) || "time".equals(kind);
  }

  /** Keeps at most n digits of the fraction of a second. */
  private static String cut(String text, int n) {
    int dot = text.indexOf('.');
    if (dot < 0 || text.length() - dot - 1 <= n) {
      return text;
    }
    return n == 0 ? text.substring(0, dot) : text.substring(0, dot + 1 + n);
  }

  private static IllegalArgumentException bad(Object v, Spec s, String why) {
    String shown = String.valueOf(v);
    if (shown.length() > 40) {
      shown = shown.substring(0, 40) + "...";
    }
    return new IllegalArgumentException(
        "Column " + s.name + " (" + s.kind + "): the value \"" + shown + "\" " + why);
  }

  private static BigDecimal number(Object v, Spec s) {
    if (v instanceof BigDecimal) {
      return (BigDecimal) v;
    }
    if (v instanceof Boolean) {
      return ((Boolean) v).booleanValue() ? BigDecimal.ONE : BigDecimal.ZERO;
    }
    try {
      BigDecimal n = new BigDecimal(String.valueOf(v).trim());
      if (n.scale() > 400 || n.scale() < -400) {
        throw bad(v, s, "is out of range");
      }
      return n;
    } catch (NumberFormatException e) {
      throw bad(v, s, "is not a number");
    }
  }

  private static Boolean bool(Object v, Spec s) {
    if (v instanceof Boolean) {
      return (Boolean) v;
    }
    if (v instanceof BigDecimal) {
      return Boolean.valueOf(((BigDecimal) v).signum() != 0);
    }
    String t = String.valueOf(v).trim().toLowerCase(Locale.ROOT);
    if (t.equals("true") || t.equals("1") || t.equals("y") || t.equals("yes") || t.equals("t")) {
      return Boolean.TRUE;
    }
    if (t.equals("false") || t.equals("0") || t.equals("n") || t.equals("no") || t.equals("f")) {
      return Boolean.FALSE;
    }
    throw bad(v, s, "is not a boolean");
  }

  private static int digits(String t, int from, int to) {
    if (to > t.length()) {
      return -1;
    }
    int n = 0;
    for (int i = from; i < to; i++) {
      char c = t.charAt(i);
      if (c < '0' || c > '9') {
        return -1;
      }
      n = n * 10 + (c - '0');
    }
    return n;
  }

  /** Checks YYYY-MM-DD at the start of the text strictly (no 31 February) and returns it. */
  private static String date(String t, Object v, Spec s) {
    int y = digits(t, 0, 4);
    int m = digits(t, 5, 7);
    int d = digits(t, 8, 10);
    boolean shape = t.length() >= 10 && t.charAt(4) == '-' && t.charAt(7) == '-';
    if (!shape || y < 1 || m < 1 || m > 12 || d < 1) {
      throw bad(v, s, "is not a date (YYYY-MM-DD)");
    }
    boolean leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    int[] days = {31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    if (d > days[m - 1]) {
      throw bad(v, s, "is not a date (YYYY-MM-DD)");
    }
    if ("date".equals(s.kind) && t.length() > 10 && t.charAt(10) != ' ' && t.charAt(10) != 'T') {
      throw bad(v, s, "is not a date (YYYY-MM-DD)");
    }
    return t.substring(0, 10);
  }

  private static String time(String t, Object v, Spec s) {
    String full = t.length() == 5 ? t + ":00" : t;
    int dot = full.indexOf('.');
    String fraction = dot < 0 ? "" : full.substring(dot);
    String base = dot < 0 ? full : full.substring(0, dot);
    int h = digits(base, 0, 2);
    int m = digits(base, 3, 5);
    int sec = digits(base, 6, 8);
    boolean shape = base.length() == 8 && base.charAt(2) == ':' && base.charAt(5) == ':'
        && fraction.matches("(\\.\\d{1,9})?");
    if (!shape || h < 0 || h > 23 || m < 0 || m > 59 || sec < 0 || sec > 59) {
      throw bad(v, s, "is not a time (HH:mm:ss)");
    }
    // java.sql.Time has no fraction; a timestamp keeps it
    return "time".equals(s.kind) ? base : base + fraction;
  }

  private static String dateTime(String t, Object v, Spec s) {
    String day = date(t, v, s);
    if (t.length() == 10) {
      return day + " 00:00:00";
    }
    try {
      return day + " " + time(t.substring(11), v, s);
    } catch (IllegalArgumentException e) {
      throw bad(v, s, "is not a date and time (YYYY-MM-DD HH:mm:ss)");
    }
  }

  private static byte[] bytes(String t, Object v, Spec s) {
    String hex = t.startsWith("0x") || t.startsWith("0X") ? t.substring(2) : t;
    if (hex.length() % 2 != 0) {
      throw bad(v, s, "is not hexadecimal");
    }
    byte[] out = new byte[hex.length() / 2];
    for (int i = 0; i < out.length; i++) {
      int hi = Character.digit(hex.charAt(i * 2), 16);
      int lo = Character.digit(hex.charAt(i * 2 + 1), 16);
      if (hi < 0 || lo < 0) {
        throw bad(v, s, "is not hexadecimal");
      }
      out[i] = (byte) (hi * 16 + lo);
    }
    return out;
  }
}
