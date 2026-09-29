# صورة العدّاء (runner) المعزول للفحوص الحية داخل sandbox
# القاعدة موثقة البصمة؛ الاعتماديات بنسخ مقفلة من قفل المشروع بلا scripts.
# البناء (بعد توليد dist لـshared وhardening عبر pnpm):
#   docker build -t agentbridge/sandbox-runner:isolated docker/sandbox-runner
FROM node:24-alpine

# مستخدم غير root مطابق لـ SANDBOX_CONSTRAINTS
RUN addgroup -S appgroup --gid 65532 && adduser -S appuser --uid 65532 -G appgroup

# deps الموثوقة — نسخ مثبتة بالضبط (لا lifecycle scripts ولا اختيار من المواصفة)
RUN mkdir -p /opt/deps/node_modules/@agentbridge
RUN npm install --prefix /opt/deps --ignore-scripts --no-audit --no-fund \
      @modelcontextprotocol/sdk@1.30.0 \
      zod@3.25.76 \
      tsx@4.19.2

# distات موثوقة بنيت على المضيف من مصدر محدد البصمة (shared + hardening)
COPY shared-package.json /opt/deps/node_modules/@agentbridge/shared/package.json
COPY hardening-package.json /opt/deps/node_modules/@agentbridge/hardening/package.json
COPY shared-dist /opt/deps/node_modules/@agentbridge/shared/dist
COPY hardening-dist /opt/deps/node_modules/@agentbridge/hardening/dist

# توجيه exports إلى dist داخل الصورة — حزم المستودع تُستهلك تطويرياً من src،
# وسياق البناء ينسخ dist حصراً؛ نصلح المؤشر هنا ليظل البناء متماسكاً بذاته.
RUN node -e "for (const n of ['shared','hardening']) { const f='/opt/deps/node_modules/@agentbridge/'+n+'/package.json'; const j=JSON.parse(require('fs').readFileSync(f,'utf8')); j.exports={'.':'./dist/index.js'}; j.main='./dist/index.js'; require('fs').writeFileSync(f, JSON.stringify(j,null,2)); }"

# runner نفسه — كود موثوق ثابت في الصورة
COPY runner.mjs /opt/deps/runner.mjs

# لا مصدر شبكة وقت التشغيل: الحاوية تقلع بـ --network none (loopback داخلي فقط)
USER 65532:65532
WORKDIR /work
