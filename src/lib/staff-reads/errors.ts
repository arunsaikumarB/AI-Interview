export class DjangoReadError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DjangoReadError";
    this.status = status;
  }
}

export function djangoReadToResponse(err: unknown): Response | null {
  if (err instanceof DjangoReadError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}
