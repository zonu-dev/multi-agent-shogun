import MaterialCollectionView from './MaterialCollectionView';
import { BukanCardList } from './BukanProgressCard';
import type { ProgressCardModel } from './useBukanData';

interface BukanShushuTabProps {
  titleCards: readonly ProgressCardModel[];
}

const BukanShushuTab = ({ titleCards }: BukanShushuTabProps) => {
  return (
    <div className="space-y-3">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold text-slate-200">蒐集称号</p>
        <BukanCardList cards={titleCards} emptyMessage="蒐集称号の定義なし" />
      </section>
      <section className="space-y-2">
        <MaterialCollectionView />
      </section>
    </div>
  );
};

export default BukanShushuTab;
