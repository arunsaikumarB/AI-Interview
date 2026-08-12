"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ROLE_LABELS } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Tab = "users" | "departments" | "org";

type StaffUser = {
  id: string;
  name: string;
  email: string;
  role: keyof typeof ROLE_LABELS;
  isActive: boolean;
  department: { id: string; name: string } | null;
};

type Dept = {
  id: string;
  name: string;
  _count?: { users: number; jobs: number };
};

type Org = {
  id: string;
  name: string;
  slug: string;
  companyName: string;
};

const CREATE_ROLES = [
  "HR_ADMIN",
  "RECRUITER",
  "HIRING_MANAGER",
  "INTERVIEWER",
  "SUPER_ADMIN",
] as const;

export function AdminConsole({
  actorRole,
}: {
  actorRole: keyof typeof ROLE_LABELS;
}) {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Failed to load users");
      return;
    }
    setUsers(data.users ?? []);
  }, []);

  const loadDepartments = useCallback(async () => {
    const res = await fetch("/api/admin/departments");
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Failed to load departments");
      return;
    }
    setDepartments(data.departments ?? []);
  }, []);

  const loadOrg = useCallback(async () => {
    const res = await fetch("/api/admin/org");
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Failed to load organization");
      return;
    }
    setOrg(data.organization);
  }, []);

  useEffect(() => {
    void loadUsers();
    void loadDepartments();
    void loadOrg();
  }, [loadUsers, loadDepartments, loadOrg]);

  async function createUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTempPassword(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        role: form.get("role"),
        departmentId: form.get("departmentId") || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Create failed");
      return;
    }
    setTempPassword(data.temporaryPassword ?? null);
    toast.success("User created — copy the temporary password now");
    e.currentTarget.reset();
    void loadUsers();
  }

  async function toggleActive(u: StaffUser) {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !u.isActive }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Update failed");
      return;
    }
    void loadUsers();
  }

  async function changeRole(u: StaffUser, role: string) {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Role change failed");
      return;
    }
    void loadUsers();
  }

  async function createDept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.get("name") }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Create failed");
      return;
    }
    e.currentTarget.reset();
    void loadDepartments();
  }

  async function renameDept(id: string, name: string) {
    const res = await fetch(`/api/admin/departments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Rename failed");
      return;
    }
    void loadDepartments();
  }

  async function deleteDept(id: string) {
    const res = await fetch(`/api/admin/departments/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Delete failed");
      return;
    }
    void loadDepartments();
  }

  async function saveOrg(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/org", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        companyName: form.get("companyName"),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Save failed");
      return;
    }
    setOrg(data.organization);
    toast.success("Organization updated");
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "users", label: "Users" },
    { id: "departments", label: "Departments" },
    { id: "org", label: "Org" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? "rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white"
                : "rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "users" ? (
        <div className="space-y-8">
          <form onSubmit={createUser} className="max-w-xl space-y-3 rounded-xl border border-slate-200 p-4">
            <h2 className="font-medium text-slate-900">Invite / create staff user</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="role">Role</Label>
                <select
                  id="role"
                  name="role"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  defaultValue="RECRUITER"
                >
                  {CREATE_ROLES.filter(
                    (r) => actorRole === "SUPER_ADMIN" || r !== "SUPER_ADMIN",
                  ).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="departmentId">Department</Label>
                <select
                  id="departmentId"
                  name="departmentId"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  defaultValue=""
                >
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="submit">Create user</Button>
            {tempPassword ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Temporary password (shown once):{" "}
                <code className="font-mono font-semibold">{tempPassword}</code>
              </p>
            ) : null}
          </form>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Dept</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{u.name}</p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      {actorRole === "SUPER_ADMIN" ? (
                        <select
                          className="rounded border border-slate-200 px-2 py-1 text-xs"
                          value={u.role}
                          onChange={(e) => void changeRole(u, e.target.value)}
                        >
                          {CREATE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge variant="secondary">{ROLE_LABELS[u.role]}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {u.department?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {u.isActive ? "Active" : "Inactive"}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void toggleActive(u)}
                      >
                        {u.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "departments" ? (
        <div className="space-y-6">
          <form onSubmit={createDept} className="flex max-w-md flex-wrap items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="deptName">New department</Label>
              <Input id="deptName" name="name" required />
            </div>
            <Button type="submit">Add</Button>
          </form>
          <ul className="space-y-2">
            {departments.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-4 py-3"
              >
                <div>
                  <p className="font-medium text-slate-900">{d.name}</p>
                  <p className="text-xs text-slate-500">
                    {d._count?.users ?? 0} users · {d._count?.jobs ?? 0} jobs
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const name = window.prompt("Rename department", d.name);
                      if (name?.trim()) void renameDept(d.id, name.trim());
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void deleteDept(d.id)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "org" && org ? (
        <form onSubmit={saveOrg} className="max-w-md space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orgName">Organization name</Label>
            <Input id="orgName" name="name" defaultValue={org.name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="companyName">Company name (email templates)</Label>
            <Input
              id="companyName"
              name="companyName"
              defaultValue={org.companyName || org.name}
            />
            <p className="text-xs text-slate-500">
              Used as {"{{companyName}}"} in communication templates.
            </p>
          </div>
          <p className="text-xs text-slate-500">Slug: {org.slug}</p>
          <Button type="submit">Save organization</Button>
        </form>
      ) : null}
    </div>
  );
}
