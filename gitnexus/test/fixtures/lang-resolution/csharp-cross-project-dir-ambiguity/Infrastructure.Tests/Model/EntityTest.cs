// This directory (Infrastructure.Tests/Model/) sorts BEFORE
// Infrastructure/Model/ alphabetically because '.' < '/'.
// Without the stripped-prefix context hint, `using Infrastructure.Model;`
// in Core/GameBoard.cs would falsely resolve here.
using Infrastructure.Model;

namespace Infrastructure.Tests.Model
{
    public class EntityTest
    {
        public void TestGetId()
        {
            var e = new Entity();
            e.GetId();
        }
    }
}
