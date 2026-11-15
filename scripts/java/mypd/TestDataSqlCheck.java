package mypd;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Accepts one read-only SELECT and nothing else, for the "query" rule of test data.
 *
 * The text that reaches the database is the text checked here with the comments taken out, so a
 * comment style one database knows and another does not cannot hide anything. What is left to get
 * wrong is where a quoted text ends, and every construct databases disagree about is refused:
 * backslashes inside quotes, PostgreSQL dollar quotes, Oracle q-quotes, '#', and quote characters
 * inside [brackets] or `backticks`. The check is deliberately stricter than any single database.
 * It is a guard against mistakes, not a sandbox: the connection is also read-only and rolled back.
 */
final class TestDataSqlCheck {
  static final class Rejected extends RuntimeException {
    private static final long serialVersionUID = 1L;
    final String code;

    Rejected(String code, String message) {
      super(message);
      this.code = code;
    }
  }

  private static final Set<String> FORBIDDEN = new HashSet<String>(Arrays.asList(
      "INSERT", "UPDATE", "DELETE", "MERGE", "UPSERT", "DROP", "ALTER", "CREATE", "TRUNCATE",
      "RENAME", "EXEC", "EXECUTE", "CALL", "INTO", "GRANT", "REVOKE",
      "OPENROWSET", "OPENQUERY", "OPENDATASOURCE"));

  private static final int MAX_LENGTH = 100000;

  private TestDataSqlCheck() {
  }

  /** The statement to run, and where each of its characters stood in the text as typed. */
  static final class Checked {
    final String sql;
    private final int[] map;
    private final int lead;
    private final int typed;

    Checked(String sql, int[] map, int lead, int typed) {
      this.sql = sql;
      this.map = map;
      this.lead = lead;
      this.typed = typed;
    }

    /** Offset in the typed text of the character at `sent` (0-based) of the statement sent. */
    int original(int sent) {
      int at = sent + lead;
      if (sent < 0) {
        return -1;
      }
      return at < map.length ? map[at] : typed;
    }
  }

  /** Returns the statement to run (comments and trailing semicolons removed) or throws Rejected. */
  static String check(String sql) {
    return checked(sql).sql;
  }

  static Checked checked(String sql) {
    if (sql == null || sql.trim().isEmpty()) {
      throw new Rejected("SQL_EMPTY", "The query is empty");
    }
    if (sql.length() > MAX_LENGTH) {
      throw new Rejected("SQL_TOO_LONG", "The query is too long");
    }
    int[] map = new int[sql.length()];
    String[] first = scan(sql, map);
    // second pass over the text that will be sent: it must read the same way with no comment left
    String[] second = scan(first[0], null);
    if (!second[0].equals(first[0])) {
      throw new Rejected("SQL_AMBIGUOUS", "The query can be read in more than one way");
    }
    String clean = stripEnd(first[0]);
    String code = stripEnd(second[1]);
    if (code.trim().isEmpty()) {
      throw new Rejected("SQL_EMPTY", "The query is empty");
    }
    if (code.indexOf(';') >= 0) {
      throw new Rejected("SQL_MULTIPLE", "Only one statement is allowed");
    }
    List<String> words = words(code);
    String start = words.isEmpty() ? "" : words.get(0);
    int at = 0;
    while (at < code.length() && (Character.isWhitespace(code.charAt(at)) || code.charAt(at) == '(')) {
      at++;
    }
    if (at >= code.length() || !isWord(code.charAt(at))
        || !("SELECT".equals(start) || "WITH".equals(start))) {
      throw new Rejected("SQL_NOT_SELECT", "The query must start with SELECT or WITH");
    }
    if ("WITH".equals(start) && !words.contains("SELECT")) {
      throw new Rejected("SQL_NOT_SELECT", "The query must contain a SELECT");
    }
    for (String w : words) {
      if (FORBIDDEN.contains(w)) {
        throw new Rejected("SQL_FORBIDDEN", "The query must not contain " + w);
      }
    }
    String sent = clean.trim();
    return new Checked(sent, java.util.Arrays.copyOf(map, first[0].length()), clean.indexOf(sent),
        sql.length());
  }

  /** [0] the text without comments, [1] the same with every quoted text reduced to its quotes. */
  private static String[] scan(String sql, int[] map) {
    StringBuilder clean = new StringBuilder();
    StringBuilder code = new StringBuilder();
    int n = sql.length();
    int i = 0;
    while (i < n) {
      char c = sql.charAt(i);
      char d = i + 1 < n ? sql.charAt(i + 1) : 0;
      if (c == '-' && d == '-') {
        note(map, clean.length(), i, 1);
        while (i < n && sql.charAt(i) != '\n' && sql.charAt(i) != '\r') {
          i++;
        }
        clean.append(' ');
        code.append(' ');
      } else if (c == '/' && d == '*') {
        int end = sql.indexOf("*/", i + 2);
        if (end < 0) {
          throw new Rejected("SQL_UNTERMINATED", "A comment is not closed");
        }
        note(map, clean.length(), i, 1);
        i = end + 2;
        clean.append(' ');
        code.append(' ');
      } else if (c == '\'' || c == '"') {
        if (c == '\'' && isQQuote(code)) {
          throw new Rejected("SQL_QUOTING", "q'...' quoting is not allowed");
        }
        int end = quotedEnd(sql, i, c);
        String text = sql.substring(i, end + 1);
        if (text.indexOf('\\') >= 0) {
          throw new Rejected("SQL_QUOTING", "A backslash inside quotes is not allowed");
        }
        note(map, clean.length(), i, text.length());
        clean.append(text);
        code.append(c).append(c);
        i = end + 1;
      } else if (c == '[') {
        String text = sql.substring(i, quotedEnd(sql, i, ']') + 1);
        if (text.indexOf('\'') >= 0 || text.indexOf('"') >= 0 || text.indexOf('`') >= 0) {
          throw new Rejected("SQL_QUOTING", "Quotes inside [ ] are not allowed");
        }
        // the content is checked as code: what one database takes as a name is code to another
        note(map, clean.length(), i, 1);
        clean.append(c);
        code.append(c);
        i++;
      } else if (c == '`') {
        int end = quotedEnd(sql, i, '`');
        String text = sql.substring(i, end + 1);
        if (text.indexOf('\'') >= 0 || text.indexOf('"') >= 0 || text.indexOf('[') >= 0
            || text.indexOf('#') >= 0 || text.contains("--") || text.contains("/*")) {
          throw new Rejected("SQL_QUOTING", "Quotes or comments inside ` ` are not allowed");
        }
        // kept in the checked text for the same reason
        note(map, clean.length(), i, text.length());
        clean.append(text);
        code.append(text);
        i = end + 1;
      } else if (c == '#') {
        throw new Rejected("SQL_QUOTING", "'#' is not allowed");
      } else if (c == '$' && isDollarQuote(sql, i)) {
        throw new Rejected("SQL_QUOTING", "Dollar quoting is not allowed");
      } else {
        note(map, clean.length(), i, 1);
        clean.append(c);
        code.append(c);
        i++;
      }
    }
    return new String[] {clean.toString(), code.toString()};
  }

  /** `count` characters written at `at` of the clean text came from `from` of the typed one. */
  private static void note(int[] map, int at, int from, int count) {
    for (int k = 0; map != null && k < count && at + k < map.length; k++) {
      map[at + k] = from + k;
    }
  }

  /** Index of the closing character, a doubled one being part of the text. */
  private static int quotedEnd(String sql, int start, char close) {
    int j = start + 1;
    while (j < sql.length()) {
      if (sql.charAt(j) == close) {
        if (j + 1 < sql.length() && sql.charAt(j + 1) == close) {
          j += 2;
          continue;
        }
        return j;
      }
      j++;
    }
    if (close == ']') {
      // an array subscript or an unclosed name: the rest of the text is what must hold no quote
      return sql.length() - 1;
    }
    throw new Rejected("SQL_UNTERMINATED", "A quoted text is not closed");
  }

  private static boolean isQQuote(StringBuilder code) {
    int k = code.length() - 1;
    if (k < 0 || Character.toUpperCase(code.charAt(k)) != 'Q') {
      return false;
    }
    k--;
    if (k >= 0 && Character.toUpperCase(code.charAt(k)) == 'N') {
      k--;
    }
    return k < 0 || !isWord(code.charAt(k));
  }

  private static boolean isDollarQuote(String sql, int at) {
    int j = at + 1;
    while (j < sql.length() && (Character.isLetterOrDigit(sql.charAt(j)) || sql.charAt(j) == '_')) {
      j++;
    }
    return j < sql.length() && sql.charAt(j) == '$';
  }

  private static boolean isWord(char c) {
    return Character.isLetterOrDigit(c) || c == '_' || c == '$' || c == '@';
  }

  private static List<String> words(String code) {
    List<String> words = new java.util.ArrayList<String>();
    int i = 0;
    while (i < code.length()) {
      if (isWord(code.charAt(i))) {
        int start = i;
        while (i < code.length() && isWord(code.charAt(i))) {
          i++;
        }
        words.add(code.substring(start, i).toUpperCase(java.util.Locale.ROOT));
      } else {
        i++;
      }
    }
    return words;
  }

  private static String stripEnd(String text) {
    int end = text.length();
    while (end > 0 && (Character.isWhitespace(text.charAt(end - 1)) || text.charAt(end - 1) == ';')) {
      end--;
    }
    return text.substring(0, end);
  }

  /**
   * Test entry: reads a JSON array of statements and writes, for each one,
   * {"ok":true,"sql":...} or {"ok":false,"code":...}. Usage: TestDataSqlCheck cases.json out.json
   */
  public static void main(String[] args) throws Exception {
    String text = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);
    StringBuilder sb = new StringBuilder("[");
    for (Object sql : TestDataJson.list(TestDataJson.parse(text), "cases")) {
      if (sb.length() > 1) {
        sb.append(',');
      }
      try {
        String checked = check((String) sql);
        sb.append("{\"ok\":true,\"sql\":").append(Tool.json(checked)).append('}');
      } catch (Rejected e) {
        sb.append("{\"ok\":false,\"code\":").append(Tool.json(e.code)).append('}');
      }
    }
    Files.write(Paths.get(args[1]), sb.append(']').toString().getBytes(StandardCharsets.UTF_8));
  }
}
