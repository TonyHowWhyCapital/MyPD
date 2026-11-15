package mypd;

/** A failure of a test data tool: a stable code for the UI plus the database's own message. */
final class TestDataFailure extends Exception {
  private static final long serialVersionUID = 1L;

  final String code;
  String table;
  long row = -1;
  String sqlState;
  int dbCode;
  /** JSON array of per-table results reached so far (write mode), or null. */
  String tables;

  TestDataFailure(String code, String message) {
    super(message == null ? code : message);
    this.code = code;
  }

  TestDataFailure at(String tableName, long rowNumber) {
    this.table = tableName;
    this.row = rowNumber;
    return this;
  }

  String toJson() {
    StringBuilder sb = new StringBuilder("{\"code\":").append(Tool.json(code));
    sb.append(",\"message\":").append(Tool.json(TestDataDb.clean(getMessage())));
    if (table != null) {
      sb.append(",\"table\":").append(Tool.json(table));
    }
    if (row >= 0) {
      sb.append(",\"row\":").append(row);
    }
    if (sqlState != null) {
      sb.append(",\"sqlState\":").append(Tool.json(sqlState));
    }
    if (dbCode != 0) {
      sb.append(",\"dbCode\":").append(dbCode);
    }
    if (tables != null) {
      sb.append(",\"tables\":").append(tables);
    }
    return sb.append('}').toString();
  }
}
