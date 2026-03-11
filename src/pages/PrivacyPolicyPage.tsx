export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 px-6 py-4">
        <a href="/" className="text-2xl font-bold text-primary">PopDAM</a>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
        <h1 className="text-3xl font-bold">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">Last updated: March 11, 2026</p>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Introduction</h2>
          <p className="text-muted-foreground leading-relaxed">
            PopDAM ("we", "our", or "us") operates the PopDAM Digital Asset Manager platform
            (the "Service"). This Privacy Policy explains how we collect, use, and protect
            information when you use our Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. Information We Collect</h2>
          <ul className="list-disc pl-6 text-muted-foreground space-y-2 leading-relaxed">
            <li><strong>Account Information:</strong> When you sign in via Google or email, we receive your name, email address, and profile picture.</li>
            <li><strong>Usage Data:</strong> We collect information about how you interact with the Service, including pages visited, features used, and timestamps.</li>
            <li><strong>Asset Metadata:</strong> File names, paths, dimensions, and tags for digital assets managed within the platform. We do not store the full design files in the cloud.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. How We Use Your Information</h2>
          <ul className="list-disc pl-6 text-muted-foreground space-y-2 leading-relaxed">
            <li>To provide, maintain, and improve the Service</li>
            <li>To authenticate users and manage access</li>
            <li>To communicate important updates about the Service</li>
            <li>To monitor and prevent security issues</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Data Storage & Security</h2>
          <p className="text-muted-foreground leading-relaxed">
            Your data is stored securely using industry-standard encryption. Authentication
            is handled through secure OAuth 2.0 protocols. We retain your data only as long
            as your account is active or as needed to provide the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Third-Party Services</h2>
          <p className="text-muted-foreground leading-relaxed">
            We use the following third-party services:
          </p>
          <ul className="list-disc pl-6 text-muted-foreground space-y-2 leading-relaxed">
            <li><strong>Google Sign-In:</strong> For authentication. Subject to <a href="https://policies.google.com/privacy" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">Google's Privacy Policy</a>.</li>
            <li><strong>DigitalOcean Spaces:</strong> For thumbnail storage.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. Your Rights</h2>
          <p className="text-muted-foreground leading-relaxed">
            You may request access to, correction of, or deletion of your personal data by
            contacting your organization's administrator or reaching out to us directly.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Contact Us</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you have questions about this Privacy Policy, please contact your PopDAM
            administrator.
          </p>
        </section>

        <footer className="pt-8 border-t border-border/50 text-sm text-muted-foreground">
          <a href="/terms" className="text-primary hover:underline mr-6">Terms of Service</a>
          <a href="/" className="text-primary hover:underline">Home</a>
        </footer>
      </main>
    </div>
  );
}
