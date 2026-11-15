package mypd;

import java.sql.SQLException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What a database says about a refused query, in a form the editor can point at: the object it
 * names (a missing table or column), the text it stopped near and where that is in the query
 * as the user typed it. Each database tells this its own way; what one does not tell stays
 * unset. Drivers are reached by reflection because none of them is known at compile time.
 */
final class TestDataDiagnose {
  private static final Pattern QUOTED = Pattern.compile("'([^']*)'");
  private static final Pattern MYSQL_NEAR = Pattern.compile("near '(.*)' at line (\\d+)\\s*$",
      Pattern.DOTALL);
  private static final Pattern MYSQL_TABLE = Pattern.compile("Table '([^']*)' doesn't exist");
  private static final Pattern MYSQL_DENIED = Pattern.compile("for table '([^']*)'");
  private static final Pattern MSSQL_BOUND = Pattern.compile("identifier \"([^\"]*)\"");
  private static final Pattern MSSQL_DENIED = Pattern.compile("on the object '([^']*)'");
  private static final Pattern PG_QUOTED = Pattern.compile("\"([^\"]*)\"");
  private static final Pattern PG_COLUMN = Pattern.compile("column (\\S+) does not exist");
  private static final Pattern PG_DENIED =
      Pattern.compile("permission denied for (?:table|view|relation|schema|sequence) (\\S+)");
  private static final Pattern ORA_NAME = Pattern.compile("((?:\"[^\"]+\"\\.)*\"[^\"]+\")");
  private static final Pattern LITE_NAME = Pattern.compile("no such (?:table|column): ([^)\\s]+)");
  private static final Pattern LITE_NEAR = Pattern.compile("near \"([^\"]*)\": syntax error");

  private TestDataDiagnose() {
  }

  /** The failure of a query: the code, and what could be read about where and what. */
  static TestDataFailure failure(Throwable e, String dialect, TestDataSqlCheck.Checked q,
      String phase) {
    TestDataFailure f = TestDataDb.failure(e);
    f.phase = phase;
    if (!(e instanceof SQLException)) {
      return f;
    }
    try {
      locate((SQLException) e, dialect == null ? "" : dialect, q, f);
    } catch (Throwable ignored) {
      // the code and the message of the database are there whatever happens here
    }
    return f;
  }

  private static void locate(SQLException e, String dialect, TestDataSqlCheck.Checked q,
      TestDataFailure f) {
    String m = e.getMessage() == null ? "" : e.getMessage();
    int c = e.getErrorCode();
    int sent = -1;
    int line = -1;
    if ("mssql".equals(dialect)) {
      if (c == 4104) {
        f.object = group(MSSQL_BOUND, m);
      } else if (c == 229 || c == 230) {
        f.object = group(MSSQL_DENIED, m);
      } else if (c == 207 || c == 208) {
        f.object = group(QUOTED, m);
      } else if ("SQL_SYNTAX".equals(f.code)) {
        f.near = group(QUOTED, m);
      }
      line = number(call(call(e, "getSQLServerError"), "getLineNumber"));
    } else if ("mysql".equals(dialect)) {
      Matcher near = MYSQL_NEAR.matcher(m);
      if (c == 1064 && near.find()) {
        f.near = near.group(1);
        line = Integer.parseInt(near.group(2));
        // the text quoted is the rest of the statement from the place of the error
        sent = f.near.isEmpty() ? q.sql.length() : q.sql.lastIndexOf(f.near);
        if (sent < 0 && f.near.length() > 20) {
          // long remainders are cut short by the server
          sent = q.sql.indexOf(f.near.substring(0, 20));
        }
      } else if (c == 1146) {
        f.object = lastPart(group(MYSQL_TABLE, m));
      } else if (c == 1054) {
        f.object = group(QUOTED, m);
      } else if (c == 1142 || c == 1143) {
        f.object = group(MYSQL_DENIED, m);
      }
    } else if ("postgresql".equals(dialect)) {
      String state = e.getSQLState() == null ? "" : e.getSQLState();
      int position = number(call(call(e, "getServerErrorMessage"), "getPosition"));
      sent = position > 0 ? position - 1 : -1;
      String first = m.split("\n")[0];
      if (state.equals("42703")) {
        String name = group(PG_COLUMN, first);
        f.object = name != null && name.startsWith("\"") ? group(PG_QUOTED, first) : name;
      } else if (state.equals("42P01")) {
        f.object = group(PG_QUOTED, first);
      } else if (state.equals("42501")) {
        f.object = group(PG_DENIED, first);
      } else if (state.equals("42601")) {
        f.near = group(PG_QUOTED, first);
      }
    } else if ("oracle".equals(dialect)) {
      Throwable cause = e.getCause();
      while (cause != null && !cause.getClass().getName().endsWith("OracleDatabaseException")) {
        cause = cause.getCause();
      }
      sent = number(call(cause, "getErrorPosition"));
      if (c == 942 || c == 904 || c == 41900 || c == 1031) {
        String name = group(ORA_NAME, m.split("\n")[0]);
        f.object = name == null ? null : name.replace("\"", "");
      }
      if (sent == 0 && c != 942 && c != 904 && !"SQL_SYNTAX".equals(f.code)) {
        // 0 is also what the driver answers when the server gave no position
        sent = -1;
      }
    } else {
      f.object = group(LITE_NAME, m);
      f.near = group(LITE_NEAR, m);
    }
    if (sent < 0 && line > 0) {
      int start = lineStart(q.sql, line);
      if (start >= 0) {
        int end = q.sql.indexOf('\n', start);
        String text = q.sql.substring(start, end < 0 ? q.sql.length() : end);
        int at = f.near == null || f.near.isEmpty() ? -1 : only(text, f.near);
        sent = at >= 0 ? start + at : start;
        f.lineOnly = at < 0;
      }
    }
    if (sent < 0 && f.near != null && !f.near.isEmpty()) {
      sent = only(q.sql, f.near);
    }
    if (sent < 0 && f.object != null && !f.object.isEmpty()) {
      // not told where: the place the name stands, when the query has it once
      sent = only(q.sql, f.object);
      if (sent < 0) {
        sent = only(q.sql, lastPart(f.object));
      }
    }
    if (sent >= 0 && f.code.matches("SQL_SYNTAX|SQL_ERROR|.*_MISSING|PERMISSION_DENIED|DB_ERROR")) {
      f.position = q.original(Math.min(sent, q.sql.length()));
    }
  }

  /** Where `word` stands in `text` when it stands there exactly once as a whole word; else -1. */
  private static int only(String text, String word) {
    String t = text.toLowerCase(Locale.ROOT);
    String w = word.toLowerCase(Locale.ROOT);
    int found = -1;
    int from = 0;
    while (true) {
      int at = t.indexOf(w, from);
      if (at < 0) {
        return found;
      }
      boolean before = at == 0 || !Character.isLetterOrDigit(t.charAt(at - 1))
          || !Character.isLetterOrDigit(w.charAt(0));
      int end = at + w.length();
      boolean after = end >= t.length() || !Character.isLetterOrDigit(t.charAt(end))
          || !Character.isLetterOrDigit(w.charAt(w.length() - 1));
      if (before && after) {
        if (found >= 0) {
          return -1;
        }
        found = at;
      }
      from = at + 1;
    }
  }

  private static int lineStart(String text, int line) {
    int start = 0;
    for (int i = 1; i < line; i++) {
      start = text.indexOf('\n', start) + 1;
      if (start <= 0) {
        return -1;
      }
    }
    return start;
  }

  private static String lastPart(String name) {
    return name == null ? null : name.substring(name.lastIndexOf('.') + 1);
  }

  private static String group(Pattern p, String text) {
    Matcher m = p.matcher(text);
    return m.find() ? m.group(1) : null;
  }

  private static Object call(Object target, String method) {
    if (target == null) {
      return null;
    }
    try {
      return target.getClass().getMethod(method).invoke(target);
    } catch (Throwable e) {
      return null;
    }
  }

  private static int number(Object value) {
    return value instanceof Number ? ((Number) value).intValue() : -1;
  }
}
