"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ImportPage } from "./import-page";
import { ExportPage } from "./export-page";

export function DataPage() {
  return (
    <div className="space-y-8">
      {/* 导入区 — 全宽大卡片 */}
      <Card>
        <CardContent className="space-y-6 pt-6 pb-8">
          <ImportPage />
        </CardContent>
      </Card>

      {/* 导出区 — 全宽大卡片 */}
      <Card>
        <CardContent className="space-y-6 pt-6 pb-8">
          <ExportPage />
        </CardContent>
      </Card>
    </div>
  );
}
