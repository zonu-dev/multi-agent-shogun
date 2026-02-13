import { BukanCardList } from './BukanProgressCard';
import type { ProgressCardModel } from './useBukanData';

interface BukanBugyoTabProps {
  titleCards: readonly ProgressCardModel[];
}

const BukanBugyoTab = ({ titleCards }: BukanBugyoTabProps) => {
  return (
    <section className="space-y-2">
      <p className="text-[11px] font-semibold text-slate-200">奉行称号</p>
      <BukanCardList cards={titleCards} emptyMessage="奉行称号の定義なし" />
    </section>
  );
};

export default BukanBugyoTab;
