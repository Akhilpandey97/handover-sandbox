import { createFileRoute } from "@tanstack/react-router";
import { Route as BaseRoute } from "./merchant-portal-data";

const base = BaseRoute.options.server!.handlers as Record<
  string,
  (ctx: { request: Request }) => Promise<Response> | Response
>;

export const Route = createFileRoute("/api/public/merchant-portal-data/$")({
  server: {
    handlers: {
      GET: ({ request }) => base['GET']!({ request }),
      POST: ({ request }) => base['POST']!({ request }),
      PUT: ({ request }) => base['PUT']!({ request }),
      PATCH: ({ request }) => base['PATCH']!({ request }),
      DELETE: ({ request }) => base['DELETE']!({ request }),
      OPTIONS: ({ request }) => base['OPTIONS']!({ request }),
    },
  },
});
