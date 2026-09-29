# حاوية مقيدة لفحوص hardening الحية — 06 §4
FROM node:24.20.0-alpine

# مستخدم غير root مطابق لـ SANDBOX_CONSTRAINTS
RUN addgroup -S appgroup --gid 65532 && adduser -S appuser --uid 65532 -G appgroup

WORKDIR /app
# نسخ أصول مجمعة فقط — نظام ملفات للقراءة باستثناء /tmp
COPY --chown=65532:65532 package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY --chown=65532:65532 packages ./packages
COPY --chown=65532:65532 apps ./apps
COPY --chown=65532:65532 tests ./tests
COPY --chown=65532:65532 docker ./docker
# مدير محدد داخل الصورة فقط؛ لا lifecycle scripts ولا إخفاء لأي فشل تثبيت.
RUN npm install --prefix /opt/pnpm pnpm@11.22.0 --ignore-scripts --no-audit --no-fund
RUN node /opt/pnpm/node_modules/pnpm/bin/pnpm.cjs install --frozen-lockfile --ignore-scripts
# لا يوجد runner مبني حالياً؛ هذه البوابة تمنع صورة توهم نجاح التشغيل قبل بناء runner فعلي.
RUN node docker/sandbox-entrypoint.mjs --check

USER 65532:65532
# readOnlyRootFilesystem مفروض عبر compose، وnetwork none إلا localhost
ENTRYPOINT ["node", "docker/sandbox-entrypoint.mjs"]
