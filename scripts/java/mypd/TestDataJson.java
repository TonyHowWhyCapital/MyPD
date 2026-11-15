package mypd;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A small JSON reader (the tools compile without libraries).
 * Objects become LinkedHashMap, arrays ArrayList, numbers BigDecimal, plus String, Boolean, null.
 */
final class TestDataJson {
  private final String s;
  private int i;

  private TestDataJson(String text) {
    this.s = text;
  }

  static Object parse(String text) {
    TestDataJson p = new TestDataJson(text);
    p.ws();
    Object v = p.value(0);
    p.ws();
    if (p.i != p.s.length()) {
      throw p.error("unexpected text after the value");
    }
    return v;
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> object(Object v, String what) {
    if (!(v instanceof Map)) {
      throw new IllegalArgumentException(what + " is not a JSON object");
    }
    return (Map<String, Object>) v;
  }

  @SuppressWarnings("unchecked")
  static List<Object> list(Object v, String what) {
    if (!(v instanceof List)) {
      throw new IllegalArgumentException(what + " is not a JSON array");
    }
    return (List<Object>) v;
  }

  static String str(Map<String, Object> m, String key) {
    Object v = m.get(key);
    if (v == null) {
      return "";
    }
    return v instanceof BigDecimal ? ((BigDecimal) v).toPlainString() : String.valueOf(v);
  }

  static long num(Map<String, Object> m, String key, long fallback) {
    Object v = m.get(key);
    try {
      if (v instanceof BigDecimal) {
        return ((BigDecimal) v).longValue();
      }
      if (v instanceof String && !((String) v).trim().isEmpty()) {
        return Long.parseLong(((String) v).trim());
      }
    } catch (RuntimeException e) {
      return fallback;
    }
    return fallback;
  }

  private IllegalArgumentException error(String message) {
    return new IllegalArgumentException("invalid JSON at character " + (i + 1) + ": " + message);
  }

  private void ws() {
    while (i < s.length()) {
      char c = s.charAt(i);
      if (c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '﻿') {
        i++;
      } else {
        break;
      }
    }
  }

  private Object value(int depth) {
    if (i >= s.length()) {
      throw error("unexpected end");
    }
    if (depth > 64) {
      throw error("nested too deeply");
    }
    char c = s.charAt(i);
    if (c == '{') {
      return object(depth);
    }
    if (c == '[') {
      return array(depth);
    }
    if (c == '"') {
      return string();
    }
    if (s.startsWith("null", i)) {
      i += 4;
      return null;
    }
    if (s.startsWith("true", i)) {
      i += 4;
      return Boolean.TRUE;
    }
    if (s.startsWith("false", i)) {
      i += 5;
      return Boolean.FALSE;
    }
    return number();
  }

  private Map<String, Object> object(int depth) {
    Map<String, Object> m = new LinkedHashMap<String, Object>();
    i++;
    ws();
    if (i < s.length() && s.charAt(i) == '}') {
      i++;
      return m;
    }
    while (true) {
      ws();
      if (i >= s.length() || s.charAt(i) != '"') {
        throw error("a property name is expected");
      }
      String key = string();
      ws();
      if (i >= s.length() || s.charAt(i) != ':') {
        throw error("':' is expected");
      }
      i++;
      ws();
      m.put(key, value(depth + 1));
      ws();
      if (i < s.length() && s.charAt(i) == ',') {
        i++;
      } else if (i < s.length() && s.charAt(i) == '}') {
        i++;
        return m;
      } else {
        throw error("',' or '}' is expected");
      }
    }
  }

  private List<Object> array(int depth) {
    List<Object> list = new ArrayList<Object>();
    i++;
    ws();
    if (i < s.length() && s.charAt(i) == ']') {
      i++;
      return list;
    }
    while (true) {
      ws();
      list.add(value(depth + 1));
      ws();
      if (i < s.length() && s.charAt(i) == ',') {
        i++;
      } else if (i < s.length() && s.charAt(i) == ']') {
        i++;
        return list;
      } else {
        throw error("',' or ']' is expected");
      }
    }
  }

  private String string() {
    StringBuilder sb = new StringBuilder();
    i++;
    while (true) {
      if (i >= s.length()) {
        throw error("unterminated string");
      }
      char c = s.charAt(i++);
      if (c == '"') {
        return sb.toString();
      }
      if (c != '\\') {
        sb.append(c);
        continue;
      }
      if (i >= s.length()) {
        throw error("unterminated escape");
      }
      char e = s.charAt(i++);
      switch (e) {
        case '"': sb.append('"'); break;
        case '\\': sb.append('\\'); break;
        case '/': sb.append('/'); break;
        case 'b': sb.append('\b'); break;
        case 'f': sb.append('\f'); break;
        case 'n': sb.append('\n'); break;
        case 'r': sb.append('\r'); break;
        case 't': sb.append('\t'); break;
        case 'u':
          if (i + 4 > s.length()) {
            throw error("incomplete unicode escape");
          }
          try {
            // surrogate pairs arrive as two escapes and simply follow each other
            sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
          } catch (NumberFormatException ex) {
            throw error("bad unicode escape");
          }
          i += 4;
          break;
        default:
          throw error("unknown escape \\" + e);
      }
    }
  }

  private BigDecimal number() {
    int start = i;
    while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) {
      i++;
    }
    if (start == i) {
      throw error("a value is expected");
    }
    BigDecimal n;
    try {
      n = new BigDecimal(s.substring(start, i));
    } catch (NumberFormatException e) {
      i = start;
      throw error("bad number");
    }
    // 1e999999999 is a valid BigDecimal that would exhaust memory when written out in full
    if (n.scale() > 400 || n.scale() < -400) {
      i = start;
      throw error("number out of range");
    }
    return n;
  }
}
