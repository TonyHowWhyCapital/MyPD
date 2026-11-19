package mypd;

import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Map;

/** Argument and result handling shared by the small tools in this package. */
final class Tool {
  private Tool() {
  }

  static String unquote(String value) {
    String v = value;
    if (v.length() >= 2 && v.startsWith("'") && v.endsWith("'")) {
      v = v.substring(1, v.length() - 1);
    }
    if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) {
      v = v.substring(1, v.length() - 1);
    }
    return v;
  }

  static String json(String text) {
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

  static void write(String out, String status, String body) throws Exception {
    try (Writer w = new OutputStreamWriter(
        Files.newOutputStream(Paths.get(out)), StandardCharsets.UTF_8)) {
      w.write("{\"status\":" + json(status) + ",\"body\":" + body + "}");
    }
  }

  /** Replaces a progress file; written beside and renamed so that a reader never sees half a file. */
  static void progress(String file, String json) {
    if (file.isEmpty()) {
      return;
    }
    try {
      Path target = Paths.get(file);
      Path temp = Paths.get(file + ".tmp");
      Files.write(temp, json.getBytes(StandardCharsets.UTF_8));
      try {
        Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
      } catch (IOException e) {
        Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
      }
    } catch (IOException e) {
      // progress is a courtesy; the work goes on
    }
  }

  static Map<String, String> params(String[] args) {
    Map<String, String> params = new HashMap<String, String>();
    for (String arg : args) {
      int at = arg.indexOf('=');
      if (at > 0) {
        params.put(arg.substring(0, at), unquote(arg.substring(at + 1)));
      }
    }
    return params;
  }
}
