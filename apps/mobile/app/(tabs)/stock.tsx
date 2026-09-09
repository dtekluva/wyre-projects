import { naira } from "@wyre/api";
import { useApi, useUser } from "@/store";
import { Badge, Card, Divider, Empty, H2, P, Row, Screen } from "@/ui";
export default function Stock() {
  const api = useApi(); const user = useUser();
  const van = api.listLocations().find((l) => l.type === "vehicle" && l.custodianId === user.id) ?? api.listLocations().find((l) => l.type === "vehicle");
  if (!van) return <Screen><Empty title="No vehicle stock location assigned" /></Screen>;
  const bal = api.balances().filter((b) => b.locationId === van.id && b.qtyOnHand > 0);
  const value = bal.reduce((s, b) => s + b.value, 0);
  return <Screen>
    <Row style={{ justifyContent: "space-between" }}><H2>{van.name}</H2><Badge tone="primary">{naira(value, true)}</Badge></Row>
    <P small tone="muted">Parts used on a visit are issued from here at weighted-average cost and checked with the visit.</P>
    {bal.length ? bal.map((b) => { const it = api.item(b.itemId); const free = api.available(it.id, van.id); const serials = it.isSerialised ? api.inStockSerials(it.id, van.id) : [];
      return <Card key={b.itemId}><Row style={{ justifyContent: "space-between" }}><P bold>{it.name}</P><P mono>{b.qtyOnHand} {it.unit}</P></Row>
        <Row style={{ justifyContent: "space-between" }}><P small tone="muted">{it.sku} · {naira(b.wacUnitCost)} each</P>{free !== b.qtyOnHand && <P small tone="faint">{free} free</P>}</Row>
        {serials.length ? <><Divider /><P small mono tone="muted">{serials.join("  ")}</P></> : null}</Card>; })
      : <Empty title="Van is empty" hint="Ask the store keeper for a transfer." />}
  </Screen>;
}
