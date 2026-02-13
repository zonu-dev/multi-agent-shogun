import { BukanCardList } from './BukanProgressCard';
import type { ProgressCardModel } from './useBukanData';

interface BukanBukoTabProps {
  titleCards: readonly ProgressCardModel[];
  achievementCards: readonly ProgressCardModel[];
}

const BukanBukoTab = ({ titleCards, achievementCards }: BukanBukoTabProps) => {
  return (
    <div className="space-y-3">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold text-slate-200">武功称号</p>
        <BukanCardList cards={titleCards} emptyMessage="武功称号の定義なし" />
      </section>
      <section className="space-y-2">
        <p className="text-[11px] font-semibold text-slate-200">兵科別武勲章</p>
        <BukanCardList cards={achievementCards} emptyMessage="武勲章データなし" />
      </section>
    </div>
  );
};

export default BukanBukoTab;
