import { ProductsFrame } from "@/components/products/v6/ProductsFrame";
import { ProductSheetSkeleton } from "@/components/products/v6/skeletons";

export default function ProductSheetLoading() {
  return (
    <ProductsFrame>
      <ProductSheetSkeleton />
    </ProductsFrame>
  );
}
