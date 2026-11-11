package mypd;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Lists the domain each column was created from.
 * SQL Server keeps it in the column extended property named by property= (default Domain).
 * PostgreSQL has real domains, so the base type is returned with the name.
 * Arguments: driver_class_name= url= username= password= property= out=
 * Body: [{"table","column","domain","type","len","scale"}], type/len/scale empty when unknown.
 */
public class ListColumnDomains {
  private static final String SQLSERVER = "SELECT t.name, c.name, CAST(p.value AS nvarchar(4000)),"
      + " '', '', '' FROM sys.extended_properties p"
      + " JOIN sys.tables t ON t.object_id = p.major_id"
      + " JOIN sys.columns c ON c.object_id = p.major_id AND c.column_id = p.minor_id"
      + " WHERE p.class = 1 AND p.name = '%s'";

  private static final String POSTGRESQL = "SELECT c.table_name, c.column_name, c.domain_name,"
      + " d.udt_name, COALESCE(d.character_maximum_length, d.numeric_precision),"
      + " d.numeric_scale FROM information_schema.columns c"
      + " JOIN information_schema.domains d"
      + " ON d.domain_schema = c.domain_schema AND d.domain_name = c.domain_name"
      + " WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')";

  private static String text(ResultSet rs, int index) throws Exception {
    String value = rs.getString(index);
    return Tool.json(value == null ? "" : value);
  }

  public static void main(String[] args) throws Exception {
    Map<String, String> params = Tool.params(args);
    String out = params.get("out");
    try {
      String url = String.valueOf(params.get("url"));
      String property = params.get("property");
      if (property == null || !property.matches("[A-Za-z0-9_]+")) {
        property = "Domain";
      }
      String sql;
      if (url.startsWith("jdbc:sqlserver:")) {
        sql = String.format(SQLSERVER, property);
      } else if (url.startsWith("jdbc:postgresql:")) {
        sql = POSTGRESQL;
      } else {
        Tool.write(out, "SUCCESS", "[]");
        return;
      }
      Class.forName(params.get("driver_class_name"));
      DriverManager.setLoginTimeout(15);
      List<String> rows = new ArrayList<String>();
      try (Connection conn = DriverManager.getConnection(
          url, params.get("username"), params.get("password"));
           Statement st = conn.createStatement();
           ResultSet rs = st.executeQuery(sql)) {
        while (rs.next()) {
          rows.add("{\"table\":" + text(rs, 1) + ",\"column\":" + text(rs, 2)
              + ",\"domain\":" + text(rs, 3) + ",\"type\":" + text(rs, 4)
              + ",\"len\":" + text(rs, 5) + ",\"scale\":" + text(rs, 6) + "}");
        }
      }
      Tool.write(out, "SUCCESS", "[" + String.join(",", rows) + "]");
    } catch (Throwable e) {
      Tool.write(out, "FAILED",
          Tool.json(String.valueOf(e.getMessage() == null ? e : e.getMessage())));
      System.exit(1);
    }
  }
}
