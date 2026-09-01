import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { BriefcaseBusiness, CalendarClock, Edit, Loader2, Plus, Save, Sparkles, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const BUSINESS_TYPES = [
  {
    value: "ecommerce",
    label: "E-commerce",
    description: "Physical product sell হলে delivery address সহ normal order flow চলবে।",
    icon: Store,
  },
  {
    value: "digital_service",
    label: "Digital Service",
    description: "Follower, diamond, coin/top-up service হলে address না চেয়ে service info দিয়ে order save হবে।",
    icon: Sparkles,
  },
  {
    value: "appointment",
    label: "Appointment",
    description: "Doctor, salon বা booking flow হলে customer name/phone এবং appointment request capture হবে।",
    icon: CalendarClock,
  },
] as const;

type BusinessType = (typeof BUSINESS_TYPES)[number]["value"];
type Platform = "messenger" | "whatsapp" | "instagram";

interface ResourceOption {
  platform: Platform;
  resource_id: string;
  name: string;
}

interface ProfileResource {
  platform: Platform;
  resource_id: string;
}

interface BusinessProfile {
  id: string | number;
  name: string;
  business_type: BusinessType;
  description?: string | null;
  is_active: boolean;
  resources: ProfileResource[];
}

const emptyForm = {
  name: "",
  business_type: "ecommerce" as BusinessType,
  description: "",
  is_active: true,
  resources: [] as ProfileResource[],
};

export default function BusinessProfilesPage() {
  const location = useLocation();
  const pathPlatform = location.pathname.includes("/dashboard/whatsapp")
    ? "whatsapp"
    : location.pathname.includes("/dashboard/instagram")
      ? "instagram"
      : location.pathname.includes("/dashboard/messenger")
        ? "messenger"
        : null;

  const [profiles, setProfiles] = useState<BusinessProfile[]>([]);
  const [resourceOptions, setResourceOptions] = useState<ResourceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<BusinessProfile | null>(null);
  const [form, setForm] = useState(emptyForm);

  const visibleResourceOptions = useMemo(() => {
    return pathPlatform ? resourceOptions.filter((resource) => resource.platform === pathPlatform) : resourceOptions;
  }, [pathPlatform, resourceOptions]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [profilesRes, optionsRes] = await Promise.all([
        api.get("/business-profiles"),
        api.get("/business-profiles/resources/options"),
      ]);
      setProfiles(Array.isArray(profilesRes.data) ? profilesRes.data : []);
      setResourceOptions(Array.isArray(optionsRes.data) ? optionsRes.data : []);
    } catch (error) {
      toast.error("Failed to load business profiles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateDialog = () => {
    setEditingProfile(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEditDialog = (profile: BusinessProfile) => {
    setEditingProfile(profile);
    setForm({
      name: profile.name || "",
      business_type: profile.business_type || "ecommerce",
      description: profile.description || "",
      is_active: profile.is_active !== false,
      resources: profile.resources || [],
    });
    setDialogOpen(true);
  };

  const toggleResource = (resource: ResourceOption, checked: boolean) => {
    setForm((current) => {
      const exists = current.resources.some((item) => item.platform === resource.platform && item.resource_id === resource.resource_id);
      if (checked && !exists) {
        return { ...current, resources: [...current.resources, { platform: resource.platform, resource_id: resource.resource_id }] };
      }
      if (!checked) {
        return { ...current, resources: current.resources.filter((item) => !(item.platform === resource.platform && item.resource_id === resource.resource_id)) };
      }
      return current;
    });
  };

  const saveProfile = async () => {
    if (!form.name.trim()) {
      toast.error("Business name is required");
      return;
    }

    try {
      setSaving(true);
      if (editingProfile) {
        await api.put(`/business-profiles/${editingProfile.id}`, form);
        toast.success("Business profile updated");
      } else {
        await api.post("/business-profiles", form);
        toast.success("Business profile created");
      }
      setDialogOpen(false);
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to save business profile");
    } finally {
      setSaving(false);
    }
  };

  const deleteProfile = async (profile: BusinessProfile) => {
    if (!window.confirm(`Delete ${profile.name}?`)) return;
    try {
      await api.delete(`/business-profiles/${profile.id}`);
      toast.success("Business profile deleted");
      await loadData();
    } catch (error) {
      toast.error("Failed to delete business profile");
    }
  };

  const typeMeta = (type: BusinessType) => BUSINESS_TYPES.find((item) => item.value === type) || BUSINESS_TYPES[0];
  const resourceName = (resource: ProfileResource) => {
    const option = resourceOptions.find((item) => item.platform === resource.platform && item.resource_id === resource.resource_id);
    return option?.name || resource.resource_id;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Business Profiles</h1>
          <p className="mt-2 text-muted-foreground">Different page/session-এর জন্য e-commerce, service অথবা appointment flow set করুন।</p>
        </div>
        <Button onClick={openCreateDialog} className="bg-[#00ff88] text-black hover:bg-[#00ff88]/90 font-black">
          <Plus className="mr-2 h-4 w-4" /> Add Business
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {BUSINESS_TYPES.map((item) => (
          <Card key={item.value} className="border-white/10 bg-[#0f0f0f]/80">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <item.icon className="h-5 w-5 text-[#00ff88]" /> {item.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{item.description}</CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-white/10 bg-[#0f0f0f]/80 shadow-[0_18px_45px_rgba(0,0,0,0.25)]">
        <CardHeader className="border-b border-white/10">
          <CardTitle className="flex items-center gap-2">
            <BriefcaseBusiness className="h-5 w-5 text-[#00ff88]" /> Profile List
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading profiles...
            </div>
          ) : profiles.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <p>No business profile created yet.</p>
              <Button onClick={openCreateDialog} variant="outline" className="mt-4 border-[#00ff88]/40 text-[#00ff88] hover:bg-[#00ff88]/10">
                Create first profile
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {profiles.map((profile) => {
                const meta = typeMeta(profile.business_type);
                return (
                  <div key={profile.id} className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-black">{profile.name}</h3>
                        <Badge className="bg-[#00ff88]/10 text-[#00ff88] hover:bg-[#00ff88]/20">{meta.label}</Badge>
                        {!profile.is_active && <Badge variant="secondary">Inactive</Badge>}
                      </div>
                      {profile.description && <p className="max-w-3xl text-sm text-muted-foreground">{profile.description}</p>}
                      <div className="flex flex-wrap gap-2">
                        {(profile.resources || []).length === 0 ? (
                          <span className="text-xs text-muted-foreground">No page/session assigned</span>
                        ) : (
                          profile.resources.map((resource) => (
                            <Badge key={`${profile.id}-${resource.platform}-${resource.resource_id}`} variant="outline" className="border-white/15 text-muted-foreground">
                              {resource.platform}: {resourceName(resource)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(profile)} className="border-white/15">
                        <Edit className="mr-2 h-4 w-4" /> Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => deleteProfile(profile)} className="border-red-500/30 text-red-400 hover:bg-red-500/10">
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl border-white/10 bg-[#0b0b0b]">
          <DialogHeader>
            <DialogTitle>{editingProfile ? "Edit Business Profile" : "Add Business Profile"}</DialogTitle>
            <DialogDescription>Business type select করলে bot order/booking flow সেই অনুযায়ী data collect করবে।</DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-2">
            <div className="grid gap-2">
              <Label>Business name</Label>
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Example: Arteque Fashion / Game Topup / Doctor Chamber" />
            </div>

            <div className="grid gap-2">
              <Label>Business type</Label>
              <Select value={form.business_type} onValueChange={(value: BusinessType) => setForm({ ...form, business_type: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BUSINESS_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Description / instruction</Label>
              <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Short note about this business flow" rows={3} />
            </div>

            <div className="grid gap-3">
              <Label>Assign pages / sessions</Label>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-3">
                {visibleResourceOptions.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No connected page/session found.</p>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {visibleResourceOptions.map((resource) => {
                      const checked = form.resources.some((item) => item.platform === resource.platform && item.resource_id === resource.resource_id);
                      return (
                        <label key={`${resource.platform}-${resource.resource_id}`} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition", checked ? "border-[#00ff88]/50 bg-[#00ff88]/10" : "border-white/10 bg-[#101010]")}> 
                          <Checkbox checked={checked} onCheckedChange={(value) => toggleResource(resource, Boolean(value))} />
                          <span className="min-w-0">
                            <span className="block truncate font-bold">{resource.name}</span>
                            <span className="text-xs capitalize text-muted-foreground">{resource.platform}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveProfile} disabled={saving} className="bg-[#00ff88] text-black hover:bg-[#00ff88]/90 font-black">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
