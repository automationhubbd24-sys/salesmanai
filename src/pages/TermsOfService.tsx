import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-[#0b0b0b] text-white flex flex-col">
      <Navbar />
      <main className="flex-grow container mx-auto px-4 pt-32 pb-16 max-w-4xl">
        <h1 className="text-4xl font-black mb-8 text-[#00ff88]">Terms of Service</h1>
        <div className="prose prose-invert max-w-none space-y-6 text-gray-300">
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">1. Acceptance of Terms</h2>
            <p>By accessing and using SalesmanChatbot, you agree to be bound by these Terms of Service and all applicable laws and regulations.</p>
          </section>
          
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">2. Use License</h2>
            <p>We grant you a personal, non-exclusive, non-transferable license to use our AI automation platform for your business needs according to your chosen plan.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-4">3. Account Security</h2>
            <p>You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-4">4. Service Limitations</h2>
            <p>Our AI services are provided "as is". While we strive for 100% uptime and accuracy, we do not guarantee that the service will be uninterrupted or error-free.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-4">5. Credit System</h2>
            <p>Credits are deducted based on usage. Monthly credits expire at the end of each billing cycle. Permanent credits do not expire.</p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
