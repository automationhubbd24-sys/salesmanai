import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, ArrowRight, Key, Globe, BookOpenText, CreditCard, Workflow } from "lucide-react";
import { toast } from "sonner";
import { EXTERNAL_API_BASE } from "@/config";
import { Link } from "react-router-dom";

export default function ApiDocsPage() {
  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  const curlExample = `curl -X POST "${EXTERNAL_API_BASE}/v1/chat/completions" \\
-H "Content-Type: application/json" \\
-H "Authorization: Bearer YOUR_SERVICE_API_KEY" \\
-d '{
  "model": "salesmanchatbot-lite",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant. Respond in Bangla." },
    { "role": "user", "content": "আজকের আবহাওয়া কেমন?" }
  ],
  "stream": false
}'`;

  const n8nSteps = [
    "n8n খুলে নতুন workflow তৈরি করুন",
    "একটি HTTP Request node যোগ করুন",
    `Method: POST, URL: ${EXTERNAL_API_BASE}/v1/chat/completions`,
    "Headers: Content-Type: application/json",
    "Headers: Authorization: Bearer YOUR_SERVICE_API_KEY",
    `Body (JSON): { "model": "salesmanchatbot-lite", "messages": [ { "role": "user", "content": "Hello" } ] }`,
    "Response JSON থেকে data নিন এবং পরবর্তী node‑এ পাঠান",
  ];

  return (
    <div className="space-y-6 p-4 md:p-8 animate-in fade-in duration-700">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <BookOpenText className="h-6 w-6 text-primary" />
            API Documentation
          </h1>
          <p className="text-muted-foreground">
            External API, pricing, n8n integration, এবং language customization — সব এক জায়গায়।
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/dashboard/api">
            <Key className="mr-2 h-4 w-4" /> Go to Developer API
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-secondary">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="n8n">n8n Setup</TabsTrigger>
          <TabsTrigger value="language">Language</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                Base URL & Endpoints
              </CardTitle>
              <CardDescription>External API endpoints and usage</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="text-sm font-medium">Base URL</label>
                <div className="flex gap-2 items-center mt-2">
                  <Input value={EXTERNAL_API_BASE} readOnly className="font-mono" />
                  <Button variant="outline" size="sm" onClick={() => copy(EXTERNAL_API_BASE)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Endpoints</label>
                <div className="rounded-lg border p-3 text-sm">
                  <div className="font-mono">
                    GET {EXTERNAL_API_BASE}/v1/models
                  </div>
                  <div className="font-mono mt-1">
                    POST {EXTERNAL_API_BASE}/v1/chat/completions
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">cURL Example</label>
                <pre className="rounded-lg border p-3 bg-muted/40 text-xs overflow-auto">
{curlExample}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pricing">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                Pricing
              </CardTitle>
              <CardDescription>Token-based billing; free trial available</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-4">
                <ul className="list-disc pl-6 text-sm">
                  <li>Free Trial: নতুন অ্যাকাউন্টে একবারে 20 requests ফ্রি</li>
                  <li>Lite Engine: প্রতি 1k tokens — dynamic rate (dashboard summary‑তে দেখবেন)</li>
                  <li>Streaming support: একই রেটে প্রযোজ্য</li>
                  <li>Minimum balance enforcement: 0.01 BDT required</li>
                </ul>
              </div>
              <p className="text-sm text-muted-foreground">
                Pricing সময় সময়ে আপডেট হতে পারে। সর্বশেষ effective rate দেখতে Developer API পেজের Usage Summary দেখুন।
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="n8n">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Workflow className="h-5 w-5 text-primary" />
                n8n Integration
              </CardTitle>
              <CardDescription>HTTP Request node দিয়ে সহজে connect করুন</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="list-decimal pl-6 space-y-2 text-sm">
                {n8nSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <div className="rounded-lg border p-3 text-xs bg-muted/40">
                টিপস: Response data থেকে ai_text বা stream chunks ব্যবহার করে পরবর্তী automation steps তৈরি করুন।
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="language">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                Custom Language
              </CardTitle>
              <CardDescription>System prompt বা user prompt দিয়ে language enforce করুন</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-3 bg-muted/40">
                <p className="text-sm">
                  Language control করার সবচেয়ে সহজ উপায় হলো system prompt এ নির্দেশনা যোগ করা:
                </p>
                <pre className="mt-2 rounded-md border p-3 text-xs overflow-auto">
{`"messages": [
  { "role": "system", "content": "You are a helpful assistant. Always respond in Bangla." },
  { "role": "user", "content": "Product details bolo" }
]`}
                </pre>
                <p className="text-sm mt-3">
                  প্রয়োজনে user prompt‑এও language উল্লেখ করতে পারেন, বা request অনুযায়ী language পরিবর্তন করুন।
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="bg-green-50/50 dark:bg-green-900/20 border-green-200/50 dark:border-green-800/50">
        <CardContent className="p-4 text-sm text-green-800 dark:text-green-300 flex items-center justify-between">
          <span>Need help? Developer API পেজে গিয়ে আপনার key দেখুন এবং regenerate করুন প্রয়োজন হলে।</span>
          <Button variant="link" asChild className="text-green-700 dark:text-green-300">
            <Link to="/dashboard/api">
              Go to Developer API <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
