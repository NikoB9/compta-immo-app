"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function InitialSetupLink() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/setup/owner", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const result: { available?: boolean } = await response.json();
        setAvailable(result.available === true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return available
    ? <p><Link className="ledger-link" href="/configuration-initiale">Configurer votre espace →</Link></p>
    : null;
}
