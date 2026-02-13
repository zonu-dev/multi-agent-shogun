import { BukanCardList } from './BukanProgressCard';
import type { ProgressCardModel } from './useBukanData';

interface BukanChikujoTabProps {
  titleCards: readonly ProgressCardModel[];
  achievementCards: readonly ProgressCardModel[];
}

const BukanChikujoTab = ({ titleCards, achievementCards }: BukanChikujoTabProps) => {
  return (
    <div className="space-y-3">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold text-slate-200">建造称号</p>
        <BukanCardList cards={titleCards} emptyMessage="建造称号の定義なし" />
      </section>
      <section className="space-y-2">
        <p className="text-[11px] font-semibold text-slate-200">城下建造譜</p>
        <BukanCardList cards={achievementCards} emptyMessage="城下建造譜データなし" />
      </section>
    </div>
  );
};

export default BukanChikujoTab;
