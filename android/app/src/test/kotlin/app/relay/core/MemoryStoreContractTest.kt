package app.relay.core
class MemoryStoreContractTest : StoreContract() { override fun newStore(): Store = MemoryStore() }
