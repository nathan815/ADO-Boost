export interface HttpFailureDetails {
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    credentials: RequestCredentials;
    body: string | null;
  };
  response: {
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    redirected: boolean;
    text: string | null;
    textReadError?: string;
  };
}

export class HttpResponseError extends Error {
  constructor(message: string, readonly details: HttpFailureDetails) {
    super(message, { cause: details });
    this.name = "HttpResponseError";
  }

  static async fromResponse(message: string, request: HttpFailureDetails["request"], response: Response): Promise<HttpResponseError> {
    const details: HttpFailureDetails = {
      request: { ...request, headers: diagnosticHeaders(new Headers(request.headers)) },
      response: {
        url: response.url,
        status: response.status,
        statusText: response.statusText,
        headers: diagnosticHeaders(response.headers),
        redirected: response.redirected,
        text: null
      }
    };
    try {
      details.response.text = await response.text();
    } catch (error) {
      details.response.textReadError = error instanceof Error ? error.message : String(error);
    }
    return new HttpResponseError(message, details);
  }
}

function diagnosticHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries([...headers].map(([name, value]) => [
    name, /authorization|cookie|token|secret|api-key/i.test(name) ? "[redacted]" : value
  ]));
}
