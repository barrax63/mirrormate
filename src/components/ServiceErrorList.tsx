"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { RouteError, RouteErrorEntry, VoiceRoute } from "@/lib/errors/service-errors";

/** Says what failed and why, such as "Voice input: OpenAI rejected the API key." */
export function useServiceErrorText(): (route: VoiceRoute, error: RouteError) => string {
  const t = useTranslations("errors");
  return useCallback(
    (route, error) =>
      t("line", {
        route: t(`routes.${route}`),
        message: t(`codes.${error.code}`, { service: t(`services.${error.service ?? "app"}`) }),
      }),
    [t]
  );
}

/** The current errors, one line each, or nothing */
export function ServiceErrorList({ errors, className }: { errors: RouteErrorEntry[]; className?: string }) {
  const errorText = useServiceErrorText();
  if (errors.length === 0) return null;
  return (
    <ul className={className} role="status">
      {errors.map(({ route, error }) => (
        <li key={route}>{errorText(route, error)}</li>
      ))}
    </ul>
  );
}
