export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 px-6 py-4">
        <a href="/" className="text-2xl font-bold text-primary">PopDAM</a>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
        <h1 className="text-3xl font-bold">Terms of Service</h1>
        <p className="text-sm text-muted-foreground">Last updated: March 11, 2026</p>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Acceptance of Terms</h2>
          <p className="text-muted-foreground leading-relaxed">
            By accessing or using the PopDAM Digital Asset Manager ("Service"), you agree
            to be bound by these Terms of Service. If you do not agree, do not use the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. Access & Accounts</h2>
          <p className="text-muted-foreground leading-relaxed">
            Access to PopDAM is by invitation only. You are responsible for maintaining the
            security of your account credentials. You must not share your account or allow
            unauthorized access.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. Permitted Use</h2>
          <p className="text-muted-foreground leading-relaxed">
            The Service is provided for managing digital assets within your organization.
            You agree to use the Service only for its intended purpose and in compliance
            with all applicable laws.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Intellectual Property</h2>
          <p className="text-muted-foreground leading-relaxed">
            All digital assets managed through PopDAM remain the property of their respective
            owners. PopDAM does not claim ownership of any content you manage through the Service.
            The PopDAM platform, its design, and code are proprietary.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Limitations of Liability</h2>
          <p className="text-muted-foreground leading-relaxed">
            The Service is provided "as is" without warranties of any kind. We are not liable
            for any indirect, incidental, or consequential damages arising from your use of
            the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. Termination</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may suspend or terminate your access at any time for violation of these terms
            or at the discretion of your organization's administrator.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Changes to Terms</h2>
          <p className="text-muted-foreground leading-relaxed">
            We reserve the right to modify these terms at any time. Continued use of the
            Service after changes constitutes acceptance of the new terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">8. Contact</h2>
          <p className="text-muted-foreground leading-relaxed">
            For questions about these Terms, please contact your PopDAM administrator.
          </p>
        </section>

        <footer className="pt-8 border-t border-border/50 text-sm text-muted-foreground">
          <a href="/privacy" className="text-primary hover:underline mr-6">Privacy Policy</a>
          <a href="/" className="text-primary hover:underline">Home</a>
        </footer>
      </main>
    </div>
  );
}
