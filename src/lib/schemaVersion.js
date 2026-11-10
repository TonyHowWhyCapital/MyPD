// Data-schema version written into saved project files. It tracks the data
// format lineage that transformationData() migrations key off, NOT the MyPD
// product version shown in the UI. Keep it at or above the highest migration
// gate (4.1.1) so current-format files never run through legacy migrations.
export default '4.9.3';
