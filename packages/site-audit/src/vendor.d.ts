declare module "@marbec/web-auto-extractor" {
  export default class WebAutoExtractor {
    public constructor(options: Record<string, unknown>);
    public parse(value: string): unknown;
  }
}

declare module "@adobe/structured-data-validator" {
  export default class Validator {
    public constructor(schema: unknown);
    public validate(
      value: unknown,
    ): Promise<Array<{ issueMessage?: string; severity?: string }>>;
  }
}
