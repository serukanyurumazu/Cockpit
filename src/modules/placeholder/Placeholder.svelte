<script lang="ts">
  import type { ModuleCtx } from "../../core/module";
  let { ctx }: { ctx: ModuleCtx } = $props();
</script>

<!-- Stand-in for a sidebar section whose content is not built yet. -->
<div class="ph">
  <h2>{ctx.state.title ?? "Bölüm"}</h2>
  <p>{ctx.state.note ?? "Bu bölüm henüz hazır değil."}</p>
</div>

<style>
  .ph { padding: 24px; color: #8a90a0; }
  h2 { color: #d6d9e0; font-weight: 600; margin: 0 0 8px; }
</style>
