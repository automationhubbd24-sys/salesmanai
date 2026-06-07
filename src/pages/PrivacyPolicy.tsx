import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#0b0b0b] text-white flex flex-col">
      <Navbar />
      <main className="flex-grow container mx-auto px-4 pt-32 pb-16 max-w-4xl">
        <h1 className="text-4xl font-black mb-8 text-[#00ff88]">Privacy Policy</h1>
        <div className="prose prose-invert max-w-none space-y-6 text-gray-300">
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">1. Data Collection</h2>
            <p>We collect minimal data required to provide our AI services, including your email address and basic profile information from connected platforms.</p>
          </section>
          
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">2. Message Privacy</h2>
            <p>Your messages are processed by AI to provide automated replies. We do not sell or share your conversation data with third parties for marketing purposes.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-4">3. Data Security</h2>
            <p>We implement industry-standard security measures to protect your data and connected account tokens.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-4">4. Third-Party Services</h2>
            <p>Our service uses AI models from providers like Google, OpenAI, and Anthropic. Your data is handled according to their respective privacy policies during processing.</p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
