import { ProductsFrame } from "@/components/products/v6/ProductsFrame";
import { ProductsListSkeleton } from "@/components/products/v6/skeletons";

export default function ProductsLoading() {
  return (
    <ProductsFrame>
      <ProductsListSkeleton />
    </ProductsFrame>
  );
}
