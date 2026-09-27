export type BilValidationLevel = "structural" | "semantic";

export interface BilValidationIssue {
  level: BilValidationLevel;
  path: string;
  message: string;
}

export class BilParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "BilParseError";
  }
}

export class BilValidationError extends Error {
  constructor(public readonly issues: BilValidationIssue[]) {
    super(issues.map((issue) => `${issue.level}:${issue.path}: ${issue.message}`).join("\n"));
    this.name = "BilValidationError";
  }
}

export class BilCompilationError extends Error {
  constructor(
    public readonly issues: ReadonlyArray<import("./bil.types").BilCompilationIssue>,
    public readonly conflicts: ReadonlyArray<import("./bil.types").BilConflict> = [],
  ) {
    super([...issues.map(({ reason }) => reason), ...conflicts.map(({ reason }) => reason)].join("\n"));
    this.name = "BilCompilationError";
  }
}
