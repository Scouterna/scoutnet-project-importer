export type ColumnMapping = {
  // by name, like step 3's sources
  column: string;
  questionId: string;
  emptyCells: "skip" | "clear";
  existing: "overwrite" | "fillEmpty";
  // groupKey → option id (or "1"/"0" for yes/no) or "skip"; every entry is confirmed
  decisions: [string, string][];
};
