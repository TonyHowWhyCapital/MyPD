package mypd;

import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Lists the databases (JDBC catalogs) a connection can see.
 * Arguments follow the engine's style: driver_class_name= url= username= password= out=
 * The result is written to the out file as {"status": "SUCCESS"|"FAILED", "body": ...}.
 */
public class ListDatabases {
  private static String unquote(String value) {
    String v = value;
    if (v.length() >= 2 && v.startsWith("'") && v.endsWith("'")) {
      v = v.substring(1, v.length() - 1);
    }
    if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) {
      v = v.substring(1, v.length() - 1);
    }
    return v;
  }

  private static String json(String text) {
    StringBuilder sb = new StringBuilder("\"");
    for (char c : text.toCharArray()) {
      if (c == '"' || c == '\\') {
        sb.append('\\').append(c);
      } else if (c < 0x20) {
        sb.append(String.format("\\u%04x", (int) c));
      } else {
        sb.append(c);
      }
    }
    return sb.append('"').toString();
  }

  private static void write(String out, String status, String body) throws Exception {
    try (Writer w = new OutputStreamWriter(
        Files.newOutputStream(Paths.get(out)), StandardCharsets.UTF_8)) {
      w.write("{\"status\":" + json(status) + ",\"body\":" + body + "}");
    }
  }

  public static void main(String[] args) throws Exception {
    Map<String, String> params = new HashMap<String, String>();
    for (String arg : args) {
      int at = arg.indexOf('=');
      if (at > 0) {
        params.put(arg.substring(0, at), unquote(arg.substring(at + 1)));
      }
    }
    String out = params.get("out");
    try {
      Class.forName(params.get("driver_class_name"));
      DriverManager.setLoginTimeout(15);
      List<String> names = new ArrayList<String>();
      try (Connection conn = DriverManager.getConnection(
          params.get("url"), params.get("username"), params.get("password"));
           ResultSet rs = conn.getMetaData().getCatalogs()) {
        while (rs.next()) {
          String name = rs.getString(1);
          if (name != null && !name.isEmpty()) {
            names.add(json(name));
          }
        }
      }
      write(out, "SUCCESS", "[" + String.join(",", names) + "]");
    } catch (Throwable e) {
      write(out, "FAILED", json(String.valueOf(e.getMessage() == null ? e : e.getMessage())));
      System.exit(1);
    }
  }
}
