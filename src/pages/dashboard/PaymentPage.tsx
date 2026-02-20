import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CreditCard, Wallet, Plus, History, CheckCircle, Clock, XCircle, Loader2, Gift, Copy } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";

// Override Transaction type to match the new schema
type Transaction = {
  id: string;
  user_email: string;
  amount: number;
  method: string;
  trx_id: string;
  sender_number: string;
  status: string;
  created_at: string;
};

const topupAmounts = [500, 1000, 2000, 5000, 10000];

export default function PaymentPage() {
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [customAmount, setCustomAmount] = useState("");
  const [selectedMethod, setSelectedMethod] = useState("bkash");
  const [transactionId, setTransactionId] = useState("");
  const [senderNumber, setSenderNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  
  // Redeem State
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("auth_token");
      if (!token) {
        return;
      }

      const res = await fetch(`${BACKEND_URL}/auth/payments/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error("Failed to load payment data");
      }

      const data = await res.json();
      setBalance(typeof data.balance === "number" ? data.balance : 0);
      if (Array.isArray(data.transactions)) {
        setTransactions(data.transactions);
      } else {
        setTransactions([]);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to load payment data");
    } finally {
      setLoading(false);
    }
  };

  const handleDeposit = async () => {
    if (!transactionId.trim()) {
        toast.error("Please enter Transaction ID");
        return;
    }
    
    if (!senderNumber.trim()) {
        toast.error("Please enter Sender Number");
        return;
    }

    // Determine amount
    const amount = parseFloat(customAmount);
    if (!amount || amount <= 0) {
        toast.error("Please enter a valid amount (Min 300 BDT)");
        return;
    }

    if (amount < 300) {
        toast.error("Minimum deposit is 300 BDT");
        return;
    }

    try {
        setSubmitting(true);
        const token = localStorage.getItem("auth_token");
        if (!token) {
          throw new Error("Please login again");
        }

        const res = await fetch(`${BACKEND_URL}/auth/payments/deposit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            amount,
            method: selectedMethod,
            trxId: transactionId,
            senderNumber,
          }),
        });

        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.error || "Failed to submit deposit");
        }

        toast.success("Deposit request submitted! Waiting for admin approval.");
        setTransactionId("");
        setSenderNumber("");
        setCustomAmount("");
        fetchData(); // Refresh list
    } catch (e: any) {
        console.error("Deposit Error:", e);
        const message = e?.message || (e instanceof Error ? e.message : "Unknown error");
        toast.error("Failed to submit deposit: " + message);
    } finally {
        setSubmitting(false);
    }
  };

  const handleRedeem = async () => {
    if (!redeemCode.trim()) {
      toast.error("Please enter a code");
      return;
    }

    setRedeeming(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        throw new Error("Please login again");
      }

      const res = await fetch(`${BACKEND_URL}/auth/payments/redeem`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: redeemCode }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "Redemption failed");
      }

      const newBalance = typeof body.balance === "number" ? body.balance : balance;
      setBalance(newBalance);

      toast.success("Successfully redeemed coupon!");
      setRedeemCode("");
      fetchData();

    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Redemption failed: " + message);
    } finally {
      setRedeeming(false);
    }
  };

  const handleQuickSelect = (amount: number) => {
      setCustomAmount(amount.toString());
  };

  const copyNumber = () => {
      navigator.clipboard.writeText("01956871403");
      toast.success("Number copied to clipboard");
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Payment / Topup</h2>
        <p className="text-muted-foreground">
          Manage your balance and payment methods
        </p>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-[#00ff88] text-black border border-[#00ff88]/40 rounded-2xl shadow-[0_10px_30px_rgba(0,255,136,0.25)]">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80 font-medium text-black">Available Balance</p>
                <p className="text-4xl font-bold mt-1 text-black">৳{balance.toLocaleString()}</p>
              </div>
              <Wallet className="h-10 w-10 opacity-80 text-black" />
            </div>
            <p className="text-xs opacity-60 mt-4">Last updated just now</p>
          </CardContent>
        </Card>
        
        {/* Redeem Code Card */}
        <Card className="md:col-span-2 rounded-2xl bg-[#00ff88]/8 border-[#00ff88]/30 backdrop-blur-sm">
            <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                    <Gift className="h-4 w-4 text-primary" />
                    Redeem Coupon
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex gap-2">
                    <Input 
                        placeholder="Enter coupon code" 
                        value={redeemCode}
                        onChange={(e) => setRedeemCode(e.target.value)}
                    />
                    <Button 
                        onClick={handleRedeem} 
                        disabled={redeeming}
                        className="bg-[#00ff88] text-black font-bold rounded-full hover:bg-[#00f07f] shadow-[0_10px_30px_rgba(0,255,136,0.25)]"
                    >
                        {redeeming ? <Loader2 className="h-4 w-4 animate-spin text-black" /> : "Redeem"}
                    </Button>
                </div>
            </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Topup Section */}
        <Card className="bg-[#0f0f0f]/90 border-white/10 shadow-sm rounded-2xl backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Manual Deposit
            </CardTitle>
            <CardDescription>Add funds via mobile banking</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            
            {/* Payment Method */}
            <div className="space-y-3">
              <Label>Select Method</Label>
              <RadioGroup value={selectedMethod} onValueChange={setSelectedMethod} className="grid grid-cols-3 gap-2">
                <div>
                  <RadioGroupItem value="bkash" id="bkash" className="peer sr-only" />
                  <Label
                    htmlFor="bkash"
                    className="flex flex-col items-center justify-center rounded-xl border-2 border-white/10 p-4 hover:border-white/20 peer-data-[state=checked]:border-[#e2136e] peer-data-[state=checked]:bg-[#e2136e]/10 cursor-pointer transition-all"
                  >
                    <span className="font-bold text-[#e2136e]">bKash</span>
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="nagad" id="nagad" className="peer sr-only" />
                  <Label
                    htmlFor="nagad"
                    className="flex flex-col items-center justify-center rounded-xl border-2 border-white/10 p-4 hover:border-white/20 peer-data-[state=checked]:border-[#ec1d24] peer-data-[state=checked]:bg-[#ec1d24]/10 cursor-pointer transition-all"
                  >
                    <span className="font-bold text-[#ec1d24]">Nagad</span>
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="rocket" id="rocket" className="peer sr-only" />
                  <Label
                    htmlFor="rocket"
                    className="flex flex-col items-center justify-center rounded-xl border-2 border-white/10 p-4 hover:border-white/20 peer-data-[state=checked]:border-[#8c3494] peer-data-[state=checked]:bg-[#8c3494]/10 cursor-pointer transition-all"
                  >
                    <span className="font-bold text-[#8c3494]">Rocket</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

             {/* Payment Details Box */}
             <div className={`p-6 rounded-xl border transition-colors ${
                 selectedMethod === 'bkash' ? 'bg-[#e2136e]/8 border-[#e2136e]/25' :
                 selectedMethod === 'nagad' ? 'bg-[#ec1d24]/8 border-[#ec1d24]/25' :
                 'bg-[#8c3494]/8 border-[#8c3494]/25'
             }`}>
               <div className="text-center">
                   <p className="text-xs font-bold uppercase tracking-widest opacity-70 mb-2">Send Money (Personal)</p>
                   <div className="flex items-center justify-center gap-3 mb-2">
                       <h2 className="text-3xl font-black font-mono tracking-wider">01956871403</h2>
                       <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-background/20" onClick={copyNumber}>
                           <Copy className="h-4 w-4" />
                       </Button>
                   </div>
                   <p className="text-xs opacity-60">Copy this number and send money</p>
               </div>
            </div>

            {/* Quick Amounts */}
            <div>
              <Label className="text-sm font-medium">Select Amount</Label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                {topupAmounts.map((amount) => (
                  <Button 
                    key={amount} 
                    variant={customAmount === amount.toString() ? "default" : "outline"} 
                    className={`${customAmount === amount.toString() ? 'bg-[#00ff88] text-black font-bold rounded-full hover:bg-[#00f07f] shadow-[0_10px_30px_rgba(0,255,136,0.25)]' : 'border-white/20'} w-full text-xs sm:text-sm`} 
                    onClick={() => handleQuickSelect(amount)}
                  >
                    ৳{amount}
                  </Button>
                ))}
              </div>
            </div>

            {/* Custom Amount */}
            <div className="space-y-2">
              <Label htmlFor="custom-amount">Amount (BDT)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">৳</span>
                <Input 
                    id="custom-amount" 
                    type="number" 
                    placeholder="Min 300" 
                    className="pl-8 font-mono font-bold" 
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                <Label htmlFor="sender-number">Sender Number</Label>
                <Input 
                    id="sender-number" 
                    placeholder="e.g. 017..." 
                    value={senderNumber}
                    onChange={(e) => setSenderNumber(e.target.value)}
                />
                </div>

                <div className="space-y-2">
                <Label htmlFor="txn-id">Transaction ID</Label>
                <Input 
                    id="txn-id" 
                    placeholder="e.g. 9H7S..." 
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                />
                </div>
            </div>

            <Button 
                className="w-full font-bold h-12 text-base bg-[#00ff88] text-black rounded-full hover:bg-[#00f07f] shadow-[0_10px_30px_rgba(0,255,136,0.25)]" 
                onClick={handleDeposit} 
                disabled={submitting}
            >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-black" /> : "Verify Payment"}
            </Button>
          </CardContent>
        </Card>

        {/* Transaction History */}
        <Card className="bg-[#0f0f0f]/90 border-white/10 h-full shadow-sm rounded-2xl backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto max-h-[600px] pr-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Details</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">No transactions found</TableCell>
                        </TableRow>
                    ) : (
                        transactions.map((txn) => {
                          const isExpense = ['plan_purchase', 'credit_purchase', 'balance_deduction', 'credit_deduction'].includes(txn.method);
                          
                          // Check if this is a credit deduction (either new method or legacy DED_ prefix)
                          const isCreditDeduction = txn.method === 'credit_deduction' || (txn.method === 'balance_deduction' && txn.trx_id?.startsWith('DED_'));

                          const methodLabels: Record<string, string> = {
                            'plan_purchase': 'Plan Purchase',
                            'credit_purchase': 'Credit Purchase',
                            'balance_deduction': 'Balance Deduction',
                            'credit_deduction': 'Message Credit Usage',
                            'bkash': 'bKash Deposit',
                            'nagad': 'Nagad Deposit',
                            'rocket': 'Rocket Deposit',
                            'referral_reward': 'Referral Reward'
                          };

                          let label = methodLabels[txn.method] || txn.method;
                          if (isCreditDeduction) {
                              label = "Message Credit Usage";
                          }

                          return (
                        <TableRow key={txn.id} className="group hover:bg-muted/50 transition-colors">
                            <TableCell>
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-sm">
                                            {label}
                                        </span>
                                        <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 font-mono text-muted-foreground hidden sm:inline-flex">
                                            {txn.trx_id?.startsWith('SYS_') ? 'SYSTEM' : txn.trx_id}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Clock className="h-3 w-3" />
                                        <span>{new Date(txn.created_at).toLocaleString()}</span>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="flex flex-col items-end gap-1">
                                    <span className={`font-mono font-bold text-base ${isExpense ? 'text-red-600' : 'text-green-600'}`}>
                                        {isExpense ? '-' : '+'}
                                        {isCreditDeduction ? `${txn.amount} Credit` : `৳${txn.amount}`}
                                    </span>
                                    <Badge 
                                        variant="secondary" 
                                        className={`text-[10px] h-5 capitalize ${
                                            txn.status === 'completed' ? 'bg-green-100 text-green-700 hover:bg-green-100' :
                                            txn.status === 'pending' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100' :
                                            'bg-red-100 text-red-700 hover:bg-red-100'
                                        }`}
                                    >
                                        {txn.status}
                                    </Badge>
                                </div>
                            </TableCell>
                        </TableRow>
                        );
                        })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
