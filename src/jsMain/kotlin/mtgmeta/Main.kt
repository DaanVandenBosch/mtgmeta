package mtgmeta

import biota.gui.Container
import biota.gui.button
import biota.gui.gui
import biota.gui.tab
import biota.gui.tabs
import biota.gui.toolbar
import biota.gui.vbox
import biota.gui.window
import biota.guiDom.DomGui
import kotlinx.browser.document
import kotlinx.browser.window

fun main() {
    if (document.body != null) {
        init()
    } else {
        window.addEventListener("DOMContentLoaded", { init() })
    }
}

private fun init() {
    gui(DomGui(rootElement = document.body!!, styleNamespace = "mtgm")) {
        window(title = "MTG Meta") {
            tabs {
                tab("Proxies") {
                    proxyWidget()
                }
                tab("Configuration") {}
            }
        }
    }
}

private fun Container.proxyWidget() {
    vbox {
        toolbar {
            button("Open file...")
        }
    }
}
