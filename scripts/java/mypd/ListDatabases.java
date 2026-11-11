package mypd;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Lists the databases (JDBC catalogs) a connection can see.
 * Arguments follow the engine's style: driver_class_name= url= username= password= out=
 * The result is written to the out file as {"status": "SUCCESS"|"FAILED", "body": ...}.
 */
public class ListDatabases {
  public static void main(String[] args) throws Exception {
    Map<String, String> params = Tool.params(args);
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
            names.add(Tool.json(name));
          }
        }
      }
      Tool.write(out, "SUCCESS", "[" + String.join(",", names) + "]");
    } catch (Throwable e) {
      Tool.write(out, "FAILED", Tool.json(String.valueOf(e.getMessage() == null ? e : e.getMessage())));
      System.exit(1);
    }
  }
}
