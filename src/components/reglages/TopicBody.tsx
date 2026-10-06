"use client";

import type { MarketCode } from "@/lib/markets";
import type { TopicId } from "@/lib/reglages/topics";
import type { AuthUser } from "@/types";
import { MarketsTopic } from "./topics/MarketsTopic";
import { OrdersTopic } from "./topics/OrdersTopic";
import { ShopsTopic } from "./topics/ShopsTopic";
import { RejectionsTopic } from "./topics/RejectionsTopic";
import { TeamTopic } from "./topics/TeamTopic";
import { WarehousesTopic } from "./topics/WarehousesTopic";
import { DeliveryTopic } from "./topics/DeliveryTopic";
import { WhatsAppTopic } from "./topics/WhatsAppTopic";
import { AdsTopic } from "./topics/AdsTopic";
import { ProspectsTopic } from "./topics/ProspectsTopic";
import { MonitoringTopic } from "./topics/MonitoringTopic";

export interface TopicProps {
  user: AuthUser;
  /** The market being set; "" only on Marchés and Surveillance, which cover every market. */
  marketId: string;
  marketCode: MarketCode | null;
}

export function TopicBody({ topic, ...props }: TopicProps & { topic: TopicId }) {
  switch (topic) {
    case "markets":
      return <MarketsTopic {...props} />;
    case "shops":
      return <ShopsTopic {...props} />;
    case "orders":
      return <OrdersTopic {...props} />;
    case "rejections":
      return <RejectionsTopic {...props} />;
    case "team":
      return <TeamTopic {...props} />;
    case "warehouses":
      return <WarehousesTopic {...props} />;
    case "delivery":
      return <DeliveryTopic {...props} />;
    case "whatsapp":
      return <WhatsAppTopic {...props} />;
    case "ads":
      return <AdsTopic {...props} />;
    case "prospects":
      return <ProspectsTopic {...props} />;
    case "monitoring":
      return <MonitoringTopic {...props} />;
  }
}
