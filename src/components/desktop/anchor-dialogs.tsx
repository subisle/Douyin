"use client";

import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AnchorRow } from "@/types/electron";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  success?: string | null;
}

function Modal({ open, onClose, title, children, loading, error, success }: ModalProps) {
  if (!open) return null;
  return (
    <div className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <Card className="border border-border shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {children}
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            {success && (
              <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
                {success}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={loading}>
                取消
              </Button>
              <Button onClick={onClose} disabled={loading} className={cn(!success && "hidden")}>
                完成
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface AddAnchorDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddAnchorDialog({ open, onClose, onSuccess }: AddAnchorDialogProps) {
  const [name, setName] = useState("");
  const [anchorId, setAnchorId] = useState("");
  const [douyinNo, setDouyinNo] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setAnchorId("");
    setDouyinNo("");
    setGender("");
    setError(null);
    setSuccess(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    const api = window.electronAPI;
    if (!api) return;
    setError(null);
    setSuccess(null);
    if (!name.trim() || !anchorId.trim()) {
      setError("请填写主播姓名和抖音ID");
      return;
    }
    setLoading(true);
    try {
      const res = await api.addAnchor({
        name: name.trim(),
        anchorId: anchorId.trim(),
        anchorName: name.trim(),
        douyinNo: douyinNo.trim(),
        gender,
      });
      if (res.success) {
        setSuccess(`已添加主播：${name.trim()}`);
        onSuccess();
      } else {
        setError(res.error || "添加失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="添加主播" loading={loading} error={error} success={success}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">主播姓名</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="必填"
            disabled={loading}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">抖音ID</label>
          <Input
            value={anchorId}
            onChange={(e) => setAnchorId(e.target.value)}
            placeholder="必填，唯一"
            disabled={loading}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">抖音号</label>
          <Input
            value={douyinNo}
            onChange={(e) => setDouyinNo(e.target.value)}
            placeholder="选填"
            disabled={loading}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">性别</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setGender("male")}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-sm transition",
                gender === "male"
                  ? "border-chart-2 bg-chart-2/10 text-chart-2"
                  : "border-border hover:bg-accent"
              )}
            >
              男
            </button>
            <button
              type="button"
              onClick={() => setGender("female")}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-sm transition",
                gender === "female"
                  ? "border-chart-1 bg-chart-1/10 text-chart-1"
                  : "border-border hover:bg-accent"
              )}
            >
              女
            </button>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={handleClose} disabled={loading}>
          取消
        </Button>
        <Button onClick={submit} disabled={loading || !!success}>
          {loading ? "保存中…" : success ? "已保存" : "保存"}
        </Button>
      </div>
    </Modal>
  );
}

interface MergeAccountsDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  anchors: AnchorRow[];
  prefillSecondary?: number;
}

export function MergeAccountsDialog({ open, onClose, onSuccess, anchors, prefillSecondary }: MergeAccountsDialogProps) {
  const [primary, setPrimary] = useState<string>("");
  const [secondary, setSecondary] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...anchors].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    [anchors]
  );

  // 从右键菜单打开时预填被合并项
  useEffect(() => {
    if (open && prefillSecondary) {
      setSecondary(String(prefillSecondary));
    }
  }, [open, prefillSecondary]);

  const reset = () => {
    setPrimary("");
    setSecondary("");
    setError(null);
    setSuccess(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    const api = window.electronAPI;
    if (!api) return;
    setError(null);
    setSuccess(null);
    if (!primary || !secondary) {
      setError("请选择两个主播");
      return;
    }
    if (primary === secondary) {
      setError("不能合并同一个主播");
      return;
    }
    setLoading(true);
    try {
      const res = await api.mergeAccounts({
        primaryPersonId: Number(primary),
        secondaryPersonId: Number(secondary),
      });
      if (res.success) {
        setSuccess(`已合并，迁移 ${res.data.moved} 个账号`);
        onSuccess();
      } else {
        setError(res.error || "合并失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const renderOptions = () =>
    sorted.map((a) => (
      <option key={a.id} value={a.id}>
        {a.name} {a.anchorId ? `(${a.anchorId})` : ""}
      </option>
    ));

  return (
    <Modal open={open} onClose={handleClose} title="合并账号" loading={loading} error={error} success={success}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">保留的主播（主账号）</label>
          <select
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            disabled={loading}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">请选择</option>
            {renderOptions()}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">合并进来的主播（将被删除）</label>
          <select
            value={secondary}
            onChange={(e) => setSecondary(e.target.value)}
            disabled={loading}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">请选择</option>
            {renderOptions()}
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          被合并的主播账号会迁移到主账号名下，原主播记录将被删除。
        </p>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={handleClose} disabled={loading}>
          取消
        </Button>
        <Button onClick={submit} disabled={loading || !!success}>
          {loading ? "合并中…" : success ? "已合并" : "确认合并"}
        </Button>
      </div>
    </Modal>
  );
}
