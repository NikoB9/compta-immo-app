"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

function subscribeToInvitationHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function getInvitationToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
}

export default function AcceptInvitation() {
  const router = useRouter();
  const token = useSyncExternalStore(subscribeToInvitationHash, getInvitationToken, () => "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "L'invitation n'a pas pu être acceptée.");
      router.push("/chantiers");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L'invitation n'a pas pu être acceptée.");
    } finally { setBusy(false); }
  }

  return (
    <section className="ledger-panel">
      {error && <p role="alert" className="ledger-error">{error}</p>}
      {!token && <p role="alert">Le lien d&apos;invitation ne contient pas de jeton valide.</p>}
      <button type="button" onClick={() => void accept()} disabled={busy || !token}>
        {busy ? "Acceptation…" : "Accepter l'invitation"}
      </button>
    </section>
  );
}
