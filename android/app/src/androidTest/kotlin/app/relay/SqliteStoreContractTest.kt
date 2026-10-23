package app.relay

import androidx.test.platform.app.InstrumentationRegistry
import app.relay.core.Store
import app.relay.core.StoreContract
import app.relay.store.SqliteStore

/** Runs the shared Store contract against the real SQLite implementation (in-memory DB). */
class SqliteStoreContractTest : StoreContract() {
    override fun newStore(): Store = SqliteStore(InstrumentationRegistry.getInstrumentation().targetContext, null)
}
