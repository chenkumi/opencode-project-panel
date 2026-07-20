import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import BottomBar from "./bottom-bar.js"

const plugin: TuiPlugin = async (api) => {
    api.slots.register({
        order: 100,
        slots: {
            app_bottom() {
                return <BottomBar api={api} />
            },
        },
    })
}

export default { id: "opencode-project-panel", tui: plugin } satisfies TuiPluginModule
