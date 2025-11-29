import Head from "next/head";
import { useRouter } from "next/router";
import { FormEvent, useEffect, useState } from "react";

import { login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If a token already exists, redirect straight to dashboard.
    const token = document.cookie
      .split("; ")
      .find((part) => part.startsWith("crmrebs_token="));
    if (token) {
      void router.replace("/");
    }
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await login(password);
      await router.replace("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to log in. Please try again."
      );
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Head>
        <title>Log in · CRMREBS</title>
      </Head>

      <div className="flex min-h-screen items-center justify-center bg-black px-6">
        <div className="w-full max-w-md rounded-2xl border border-black/30 bg-black px-6 py-8 shadow-lg">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3rem] text-white/60">
              CRMREBS
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white">
              Welcome back
            </h1>
            <p className="mt-2 text-sm text-white/70">
              Enter the admin password to access the outreach queue.
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label
                htmlFor="password"
                className="text-sm font-medium text-white/90"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 shadow-sm focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {error ? (
              <p className="text-sm text-rose-400" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}





