export const API_BASE_URL = "https://api.capacities.io";

export function getApiKey(): string {
	const apiKey = process.env.CAPACITIES_API_KEY;
	if (!apiKey) {
		throw new Error("CAPACITIES_API_KEY environment variable is required");
	}
	return apiKey;
}

/** Error thrown for non-2xx API responses. `message` never contains the raw response body. */
export class CapacitiesApiError extends Error {
	readonly status: number;
	readonly endpoint: string;

	constructor(status: number, endpoint: string, message: string) {
		super(message);
		this.name = "CapacitiesApiError";
		this.status = status;
		this.endpoint = endpoint;
	}
}

/** Strip the query string so ids/cursors never end up in error messages. */
function pathOnly(endpoint: string): string {
	const q = endpoint.indexOf("?");
	return q === -1 ? endpoint : endpoint.slice(0, q);
}

/**
 * Pull a short, safe diagnostic out of an error body: only the `code` field
 * (e.g. "cap_not_authenticated") when it looks like an identifier. Free-form
 * message text and anything else is deliberately dropped.
 */
function safeErrorCode(body: string): string | undefined {
	try {
		const parsed = JSON.parse(body) as unknown;
		if (parsed && typeof parsed === "object") {
			const code = (parsed as Record<string, unknown>).code;
			if (typeof code === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(code)) {
				return code;
			}
		}
	} catch {
		// body wasn't JSON — ignore
	}
	return undefined;
}

export function describeHttpError(
	status: number,
	statusText: string,
	endpoint: string,
	code?: string,
): string {
	const path = pathOnly(endpoint);
	const suffix = code ? ` (code: ${code})` : "";
	switch (status) {
		case 401:
			return `Capacities API authentication failed (401) on ${path}. Check that CAPACITIES_API_KEY is a valid, unexpired cap-api token.${suffix}`;
		case 403:
			return `Capacities API access forbidden (403) on ${path}. The token does not have permission for this operation or object.${suffix}`;
		case 404:
			return `Capacities API: not found (404) on ${path}. Check that the id exists and belongs to the space this token is scoped to.${suffix}`;
		case 429:
			return `Capacities API rate limit exceeded on ${path}. Please wait before retrying.${suffix}`;
		default:
			if (status >= 500) {
				return `Capacities API returned ${status} on ${path}. This is a server-side issue with the Capacities API; try again later.${suffix}`;
			}
			return `Capacities API error: ${status} ${statusText} on ${path}${suffix}`;
	}
}

/** Build a query string with every value URL-encoded. Undefined values are skipped. */
export function buildQuery(
	params: Record<string, string | number | boolean | undefined>,
): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) search.set(key, String(value));
	}
	const qs = search.toString();
	return qs ? `?${qs}` : "";
}

export async function makeApiRequest(
	endpoint: string,
	options: RequestInit = {},
): Promise<Response> {
	const apiKey = getApiKey();

	const requestOptions = {
		...options,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			...options.headers,
		},
	};

	const response = await fetch(`${API_BASE_URL}${endpoint}`, requestOptions);

	if (!response.ok) {
		let code: string | undefined;
		try {
			code = safeErrorCode(await response.text());
		} catch {
			// unreadable body — fall back to status-only message
		}
		throw new CapacitiesApiError(
			response.status,
			endpoint,
			describeHttpError(response.status, response.statusText, endpoint, code),
		);
	}

	return response;
}
