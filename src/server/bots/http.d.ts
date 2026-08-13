export function handleBotsRequest(input: {
  method: string;
  path: string[];
  body?: Record<string, unknown>;
  searchParams?: URLSearchParams;
}): Promise<{ status: number; body: unknown }>;
